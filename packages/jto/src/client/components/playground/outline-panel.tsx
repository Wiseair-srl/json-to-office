import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  Box,
  Braces,
  ChevronRight,
  Hash,
  Heading,
  Image as ImageIcon,
  Layers,
  List as ListIcon,
  ListTree,
  Pilcrow,
  Presentation,
  Square,
  Table as TableIcon,
  Type,
} from 'lucide-react';
import debounce from 'lodash.debounce';
import { useShallow } from 'zustand/react/shallow';
import {
  buildOutline,
  collectErrorNodeIds,
  computeReorderEdit,
  pathToOffset,
  type OutlineDocType,
  type OutlineNode,
} from '../../lib/document-outline';
import { FORMAT } from '../../lib/env';
import { cn } from '../../lib/utils';
import { useDocumentsStore } from '../../store/documents-store-provider';
import { useEditorRefsStore } from '../../store/editor-refs-store';
import { RailIconButton, SectionLabel } from './sidebar-shared';

/**
 * Sidebar "Outline" section: a semantic table of contents for the document in
 * the active editor tab. Slides/headings/components (or theme keys) map to
 * exact ranges in the Monaco model, giving click-to-reveal, cursor-follow
 * highlighting, validation-error badges, and drag-to-reorder of siblings.
 */

const KIND_ICONS: Record<
  string,
  React.ComponentType<{ className?: string }>
> = {
  slide: Presentation,
  heading: Heading,
  text: Type,
  paragraph: Pilcrow,
  chart: BarChart3,
  highcharts: BarChart3,
  table: TableIcon,
  image: ImageIcon,
  shape: Square,
  list: ListIcon,
  toc: ListTree,
  section: Layers,
  columns: Layers,
  'text-box': Type,
  statistic: Hash,
  key: Braces,
};

interface DragState {
  dragId: string;
  /** Tree id of the dragged node's parent ('' for a root-level node). */
  parentId: string;
  overId: string | null;
  overHalf: 'before' | 'after';
}

/** Resolve a positional tree id ("2.0.1") back to a node in a fresh outline. */
function findById(nodes: OutlineNode[], id: string): OutlineNode | null {
  let list = nodes;
  let node: OutlineNode | null = null;
  for (const part of id.split('.')) {
    node = list[Number(part)] ?? null;
    if (!node) return null;
    list = node.children;
  }
  return node;
}

function parentIdOf(id: string): string {
  const i = id.lastIndexOf('.');
  return i === -1 ? '' : id.slice(0, i);
}

function OutlinePanelComponent() {
  const { activeTab, documentTypes } = useDocumentsStore(
    useShallow((state) => ({
      activeTab: state.activeTab,
      documentTypes: state.documentTypes,
    }))
  );
  const storeText = useDocumentsStore((state) =>
    state.activeTab
      ? state.documents.find((d) => d.name === state.activeTab)?.text
      : undefined
  );
  const editorRef = useEditorRefsStore((state) =>
    activeTab ? state.editors.get(activeTab) ?? null : null
  );

  const docType: OutlineDocType =
    activeTab && documentTypes[activeTab] === 'application/json+theme'
      ? 'theme'
      : 'document';

  const [open, setOpen] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem('dev-env.outline-open');
      return stored ? stored === 'true' : true;
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('dev-env.outline-open', String(open));
    } catch {}
  }, [open]);

  const [outline, setOutline] = useState<OutlineNode[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [errorIds, setErrorIds] = useState<Set<string>>(() => new Set());
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [drag, setDrag] = useState<DragState | null>(null);

  const outlineRef = useRef<OutlineNode[]>(outline);
  outlineRef.current = outline;
  const listRef = useRef<HTMLDivElement>(null);
  const lastInitTabRef = useRef<string | null>(null);

  const rebuild = useCallback(() => {
    if (!activeTab) {
      setOutline([]);
      return;
    }
    const text = editorRef?.editor.getModel()?.getValue() ?? storeText ?? '';
    const nodes = buildOutline(text, FORMAT, docType);
    setOutline(nodes);
    if (lastInitTabRef.current !== activeTab) {
      lastInitTabRef.current = activeTab;
      // DOCX reports open with the heading skeleton visible; slides and theme
      // keys start folded — cursor-follow expands the path you're in anyway.
      const init = new Set<string>();
      if (docType === 'document' && FORMAT === 'docx') {
        for (const n of nodes) if (n.kind === 'heading') init.add(n.id);
      }
      setExpanded(init);
      setActiveId(null);
    }
  }, [activeTab, editorRef, storeText, docType]);

  // Rebuild on tab switch / external text changes, and (debounced) on typing.
  useEffect(() => {
    rebuild();
    const model = editorRef?.editor.getModel();
    if (!model) return;
    const debounced = debounce(rebuild, 300);
    const sub = model.onDidChangeContent(() => debounced());
    return () => {
      debounced.cancel();
      sub.dispose();
    };
  }, [rebuild, editorRef]);

  // Cursor-follow: highlight and reveal the node the cursor is inside.
  useEffect(() => {
    if (!editorRef) return;
    const { editor } = editorRef;
    const debounced = debounce(() => {
      const model = editor.getModel();
      const position = editor.getPosition();
      if (!model || !position) return;
      const offset = model.getOffsetAt(position);
      const path = pathToOffset(outlineRef.current, offset);
      if (path.length === 0) {
        setActiveId(null);
        return;
      }
      setActiveId(path[path.length - 1]);
      const ancestors = path.slice(0, -1);
      if (ancestors.length) {
        setExpanded((prev) => {
          if (ancestors.every((id) => prev.has(id))) return prev;
          const next = new Set(prev);
          for (const id of ancestors) next.add(id);
          return next;
        });
      }
    }, 150);
    const sub = editor.onDidChangeCursorPosition(() => debounced());
    return () => {
      debounced.cancel();
      sub.dispose();
    };
  }, [editorRef]);

  // Keep the active row in view.
  useEffect(() => {
    if (!activeId || !listRef.current) return;
    const el = listRef.current.querySelector(
      `[data-oid="${CSS.escape(activeId)}"]`
    );
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeId]);

  // Validation-error badges, remapped whenever markers or the outline change.
  useEffect(() => {
    if (!editorRef) {
      setErrorIds(new Set());
      return;
    }
    const { editor, monaco } = editorRef;
    const compute = () => {
      const model = editor.getModel();
      if (!model) return;
      const offsets = monaco.editor
        .getModelMarkers({ resource: model.uri })
        .filter((m) => m.severity === monaco.MarkerSeverity.Error)
        .map((m) =>
          model.getOffsetAt({
            lineNumber: m.startLineNumber,
            column: m.startColumn,
          })
        );
      setErrorIds(collectErrorNodeIds(outlineRef.current, offsets));
    };
    compute();
    const sub = monaco.editor.onDidChangeMarkers((uris) => {
      const model = editor.getModel();
      if (model && uris.some((u) => u.toString() === model.uri.toString())) {
        compute();
      }
    });
    return () => sub.dispose();
  }, [editorRef, outline]);

  const toggleExpanded = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const revealNode = useCallback(
    (node: OutlineNode) => {
      setActiveId(node.id);
      if (!editorRef) return;
      const { editor, monaco } = editorRef;
      const model = editor.getModel();
      if (!model) return;
      const start = model.getPositionAt(node.start);
      const end = model.getPositionAt(node.end);
      const range = new monaco.Range(
        start.lineNumber,
        start.column,
        end.lineNumber,
        end.column
      );
      editor.revealRangeNearTopIfOutsideViewport(
        range,
        monaco.editor.ScrollType.Smooth
      );
      editor.setPosition(start);
      editor.focus();
      const flash = editor.deltaDecorations(
        [],
        [{ range, options: { className: 'jto-outline-flash' } }]
      );
      window.setTimeout(() => editor.deltaDecorations(flash, []), 700);
    },
    [editorRef]
  );

  /**
   * Reorder is computed against a FRESH parse of the live model text — the
   * rendered outline can be up to 300ms stale, and applying stale offsets
   * would corrupt the document. Ids resolve positionally; if the structure
   * changed underneath the drag, resolution fails and we abort quietly.
   */
  const performDrop = useCallback(
    (state: DragState) => {
      if (!editorRef || !state.overId) return;
      const { editor, monaco, collapse } = editorRef;
      const model = editor.getModel();
      if (!model) return;
      const liveText = model.getValue();
      const liveOutline = buildOutline(liveText, FORMAT, docType);
      const siblings = state.parentId
        ? findById(liveOutline, state.parentId)?.children ?? []
        : liveOutline;
      const from = siblings.findIndex((n) => n.id === state.dragId);
      const overIndex = siblings.findIndex((n) => n.id === state.overId);
      if (from === -1 || overIndex === -1) return;
      let to = overIndex + (state.overHalf === 'after' ? 1 : 0);
      if (from < to) to -= 1;
      const edit = computeReorderEdit(liveText, siblings, from, to);
      if (!edit) return;
      const start = model.getPositionAt(edit.start);
      const end = model.getPositionAt(edit.end);
      editor.executeEdits('outline-reorder', [
        {
          range: new monaco.Range(
            start.lineNumber,
            start.column,
            end.lineNumber,
            end.column
          ),
          text: edit.text,
        },
      ]);
      collapse?.resyncDecorations();
    },
    [editorRef, docType]
  );

  const rows = useMemo(() => {
    const out: React.ReactNode[] = [];
    const render = (nodes: OutlineNode[], depth: number, parentId: string) => {
      const groupId = nodes[0]?.reorder?.groupId;
      const draggableGroup =
        nodes.length > 1 &&
        groupId !== undefined &&
        nodes.every((n) => n.reorder?.groupId === groupId);
      nodes.forEach((node) => {
        const Icon = KIND_ICONS[node.kind] ?? Box;
        const hasChildren = node.children.length > 0;
        const isExpanded = expanded.has(node.id);
        const isActive = activeId === node.id;
        const isDragOver = drag?.overId === node.id;
        out.push(
          <div
            key={node.id}
            data-oid={node.id}
            role="treeitem"
            aria-selected={isActive}
            aria-expanded={hasChildren ? isExpanded : undefined}
            tabIndex={0}
            draggable={draggableGroup}
            onClick={() => revealNode(node)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                revealNode(node);
              }
              if (e.key === 'ArrowRight' && hasChildren && !isExpanded) {
                toggleExpanded(node.id);
              }
              if (e.key === 'ArrowLeft' && hasChildren && isExpanded) {
                toggleExpanded(node.id);
              }
            }}
            onDragStart={(e) => {
              e.dataTransfer.setData('text/plain', node.id);
              e.dataTransfer.effectAllowed = 'move';
              setDrag({
                dragId: node.id,
                parentId,
                overId: null,
                overHalf: 'before',
              });
            }}
            onDragOver={(e) => {
              if (!drag || drag.dragId === node.id) return;
              if (parentIdOf(drag.dragId) !== parentId) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              const rect = e.currentTarget.getBoundingClientRect();
              const half =
                e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
              if (drag.overId !== node.id || drag.overHalf !== half) {
                setDrag({ ...drag, overId: node.id, overHalf: half });
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (drag) {
                performDrop({
                  ...drag,
                  overId: node.id,
                  overHalf: drag.overHalf,
                });
              }
              setDrag(null);
            }}
            onDragEnd={() => setDrag(null)}
            className={cn(
              'group flex h-6 w-full cursor-pointer items-center gap-1 rounded-sm pr-1',
              'text-[12px] text-sidebar-foreground/80 transition-colors select-none',
              'hover:bg-sidebar-accent hover:text-sidebar-foreground',
              'focus-visible:ring-sidebar-ring focus-visible:ring-1 focus-visible:outline-none',
              isActive &&
                'bg-sidebar-accent font-medium text-sidebar-foreground',
              isDragOver &&
                drag?.overHalf === 'before' &&
                'shadow-[inset_0_2px_0_hsl(var(--ring))]',
              isDragOver &&
                drag?.overHalf === 'after' &&
                'shadow-[inset_0_-2px_0_hsl(var(--ring))]'
            )}
            style={{ paddingLeft: 4 + depth * 12 }}
          >
            {hasChildren ? (
              <span
                role="button"
                aria-label={isExpanded ? 'Collapse' : 'Expand'}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleExpanded(node.id);
                }}
                className="flex size-3.5 shrink-0 items-center justify-center rounded-xs text-sidebar-foreground/55 hover:text-sidebar-foreground"
              >
                <ChevronRight
                  className={cn(
                    'size-3 transition-transform',
                    isExpanded && 'rotate-90'
                  )}
                />
              </span>
            ) : (
              <span className="size-3.5 shrink-0" />
            )}
            {node.kind === 'slide' && (
              <span className="w-3 shrink-0 text-right text-[10px] tabular-nums text-sidebar-foreground/50">
                {node.detail}
              </span>
            )}
            <Icon className="size-3.5 shrink-0 text-sidebar-foreground/55" />
            <span className="min-w-0 flex-1 truncate">{node.label}</span>
            {node.kind !== 'slide' && node.detail && (
              <span className="shrink-0 text-[10px] text-sidebar-foreground/50">
                {node.detail}
              </span>
            )}
            {errorIds.has(node.id) && (
              <span
                aria-label="Contains validation errors"
                className="bg-destructive size-1.5 shrink-0 rounded-full"
              />
            )}
          </div>
        );
        if (hasChildren && isExpanded) {
          render(node.children, depth + 1, node.id);
        }
      });
    };
    render(outline, 0, '');
    return out;
  }, [
    outline,
    expanded,
    activeId,
    errorIds,
    drag,
    revealNode,
    toggleExpanded,
    performDrop,
  ]);

  if (!activeTab) return null;

  return (
    // shrink-0: as a flex child of the scrollable SidebarContent this section
    // must keep its content height — with min-h-0 it would absorb all the
    // shrinkage once the rail overflows and clip every row to nothing.
    <section className="mt-3 shrink-0">
      <SectionLabel
        count={outline.length || undefined}
        actions={
          <RailIconButton
            aria-label={open ? 'Collapse outline' : 'Expand outline'}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <ChevronRight
              className={cn('transition-transform', open && 'rotate-90')}
            />
          </RailIconButton>
        }
      >
        Outline
      </SectionLabel>
      {open &&
        (outline.length > 0 ? (
          <div
            ref={listRef}
            role="tree"
            aria-label="Document outline"
            className="max-h-[45vh] overflow-y-auto"
          >
            {rows}
          </div>
        ) : (
          <p className="px-2 py-1 text-[12px] leading-tight text-sidebar-foreground/60">
            No structure to show yet.
          </p>
        ))}
    </section>
  );
}

export const OutlinePanel = memo(OutlinePanelComponent);
