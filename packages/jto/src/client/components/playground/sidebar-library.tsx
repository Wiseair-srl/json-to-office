import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  CircleAlert,
  CircleCheck,
  Info,
  MoreHorizontal,
  Plus,
  Puzzle,
} from 'lucide-react';
import { Spinner } from '../ui/spinner';
import { Switch } from '../ui/switch';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '../ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { Dialog, DialogContent } from '../ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import {
  EmptyRow,
  HighlightedText,
  RailIconButton,
  SectionLabel,
} from './sidebar-shared';
import { DocumentFormDialogContentMemoized } from './document-form-dialog-content';
import { cn } from '../../lib/utils';
import { download } from '../../lib/download';
import type { PluginMetadata } from '../../hooks/useDiscovery';
import type { TextFile } from '../../lib/types';
import { useDocumentsStore } from '../../store/documents-store-provider';
import { useBrowserPluginsStore } from '../../store/browser-plugins-store';
import { BROWSER_PLUGINS_CHANGED_EVENT } from '../../hooks/useBrowserPluginsSync';

/**
 * The on-disk half of the rail.
 *
 * These rows no longer live in a section of their own. A file is a file: the
 * project's documents sit in the Documents list under the ones already open,
 * its themes under the open themes. The rail used to render both — the same
 * name twice, once as an open row and once as a library row tagged "Open" —
 * which asked the reader to hold two models of the same file.
 *
 * What is left here is the row itself and the one section that genuinely is
 * not a file list: plugins.
 */

const LOCATION_LABELS: Record<string, string> = {
  current: 'Current directory',
  downstream: 'Project',
};

/** Rendered only when a kind actually spans more than one location. */
export function LocationDivider({ location }: { location: string }) {
  return (
    <li className="list-none px-2 pt-2 pb-0.5 text-[10px] tracking-[0.08em] text-sidebar-foreground/65 uppercase">
      {LOCATION_LABELS[location] ?? location}
    </li>
  );
}

/**
 * A file on disk that is not open yet. Quieter than an open row and one click
 * from becoming one, so the `+` is the whole affordance — no icon, no badge,
 * nothing competing with the rows above it.
 */
export function LibraryRow({
  name,
  subtitle,
  query,
  onSelect,
}: {
  name: string;
  subtitle?: string;
  query: string;
  onSelect: () => void;
}) {
  return (
    <li className="list-none">
      <button
        type="button"
        onClick={onSelect}
        title={subtitle ? `${name} — ${subtitle}` : name}
        aria-label={`Add ${name} to workspace`}
        className={cn(
          'group/row flex h-7 w-full cursor-pointer items-center gap-2 rounded-sm pr-1 pl-2',
          'text-[13px] text-sidebar-foreground/70 transition-colors',
          'hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
          'focus-visible:ring-sidebar-ring focus-visible:ring-1 focus-visible:outline-none'
        )}
      >
        <span className="min-w-0 flex-1 truncate text-left">
          <HighlightedText text={name} query={query} />
        </span>
        <Plus
          aria-hidden
          className="size-3.5 shrink-0 text-sidebar-foreground/45 opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-visible/row:opacity-100"
        />
      </button>
    </li>
  );
}

/** Small divider between the two origins a plugin can have. */
function OriginDivider({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 pt-2 pb-0.5 text-[10px] tracking-[0.08em] text-sidebar-foreground/65 uppercase">
      {children}
    </div>
  );
}

type RowAction = {
  key: string;
  label: string;
  separatorBefore?: boolean;
  danger?: boolean;
  run: () => void;
};

/**
 * A plugin written in the playground: a file like a document — it opens in a
 * tab, renames, deletes — but it also has a switch, because whether it takes
 * part in the next build is a per-run setting like a disk plugin's.
 *
 * Status rides on a dot rather than a chip: `--success` says it compiled and
 * `--destructive` says it did not, which is the one place the rail spends
 * those two hues.
 */
function BrowserPluginRow({
  document,
  query,
}: {
  document: TextFile;
  query: string;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const openDocument = useDocumentsStore((s) => s.openDocument);
  const activeTab = useDocumentsStore((s) => s.activeTab);
  const record = useBrowserPluginsStore((s) => s.records[document.name]);
  const setEnabled = useBrowserPluginsStore((s) => s.setEnabled);

  const isEditing = activeTab === document.name;
  const enabled = record?.enabled ?? true;
  const status = record?.status ?? 'idle';
  const componentName = record?.metadata?.name;
  const errorCount = (record?.diagnostics ?? []).filter(
    (d) => d.severity === 'error'
  ).length;

  const statusLabel =
    status === 'ready'
      ? `Ready${componentName ? ` — used as "${componentName}"` : ''}`
      : status === 'error'
        ? errorCount > 0
          ? `${errorCount} error${errorCount === 1 ? '' : 's'} — open to fix`
          : 'Failed to load — open to fix'
        : status === 'compiling'
          ? 'Compiling…'
          : 'Not compiled yet';

  const toggle = useCallback(
    (next: boolean) => {
      setEnabled(document.name, next);
      window.dispatchEvent(
        new CustomEvent(BROWSER_PLUGINS_CHANGED_EVENT, {
          detail: { docName: document.name },
        })
      );
    },
    [document.name, setEnabled]
  );

  const actions: RowAction[] = useMemo(
    () => [
      { key: 'open', label: 'Open', run: () => openDocument(document.name) },
      {
        key: 'download',
        label: 'Download…',
        separatorBefore: true,
        run: () =>
          download(
            document.name,
            new Blob([document.text], { type: 'text/typescript' })
          ),
      },
      {
        key: 'rename',
        label: 'Rename…',
        separatorBefore: true,
        run: () => setRenameOpen(true),
      },
      {
        key: 'delete',
        label: 'Delete',
        danger: true,
        run: () => setDeleteOpen(true),
      },
    ],
    [document.name, document.text, openDocument]
  );

  const switchId = `browser-plugin-${document.name}`;
  const anyMenuOpen = menuOpen || contextOpen;

  return (
    <li className="group/menu-item relative list-none">
      <ContextMenu onOpenChange={setContextOpen}>
        <ContextMenuTrigger className="block">
          <div
            className={cn(
              'flex h-7 w-full items-center gap-1 rounded-sm pr-1 pl-2 transition-colors',
              'hover:bg-sidebar-accent/60',
              anyMenuOpen && 'bg-sidebar-accent/60',
              isEditing && 'bg-sidebar-accent font-medium'
            )}
            title={`${document.name} — ${statusLabel}`}
          >
            {isEditing && (
              <span
                aria-hidden
                className="bg-primary absolute top-1 bottom-1 left-0 w-[2px] rounded-full"
              />
            )}
            <button
              ref={buttonRef}
              type="button"
              onClick={() => openDocument(document.name)}
              aria-label={`${document.name} — ${statusLabel}`}
              className={cn(
                'flex h-7 min-w-0 flex-1 cursor-pointer items-center gap-2 text-[13px]',
                'focus-visible:ring-sidebar-ring rounded-sm focus-visible:ring-1 focus-visible:outline-none',
                enabled
                  ? 'text-sidebar-foreground/85'
                  : 'text-sidebar-foreground/60'
              )}
            >
              <Puzzle
                className={cn(
                  'size-3.5 shrink-0',
                  isEditing
                    ? 'text-sidebar-accent-foreground/70'
                    : 'text-sidebar-foreground/60'
                )}
              />
              <span className="truncate">
                <HighlightedText text={document.name} query={query} />
              </span>
              {/* The state is spelled out in the row's label; the icon is
                  for scanning the list, so it gets a shape, not only a hue. */}
              {status === 'compiling' && (
                <Spinner size="sm" className="shrink-0" />
              )}
              {status === 'ready' && (
                <CircleCheck
                  aria-hidden
                  className="size-3 shrink-0 text-success"
                />
              )}
              {status === 'error' && (
                <CircleAlert
                  aria-hidden
                  className="size-3 shrink-0 text-destructive"
                />
              )}
            </button>
            <DropdownMenu onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <RailIconButton
                  aria-label={`Actions for ${document.name}`}
                  className={cn(
                    'opacity-0 group-hover/menu-item:opacity-100 focus-visible:opacity-100',
                    anyMenuOpen && 'opacity-100'
                  )}
                >
                  <MoreHorizontal />
                </RailIconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="right" align="start" className="w-44">
                {actions.map((action) => (
                  <React.Fragment key={action.key}>
                    {action.separatorBefore && <DropdownMenuSeparator />}
                    <DropdownMenuItem
                      onClick={action.run}
                      className={cn(
                        action.danger &&
                          'text-destructive focus:text-destructive'
                      )}
                    >
                      {action.label}
                    </DropdownMenuItem>
                  </React.Fragment>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Switch
              id={switchId}
              checked={enabled}
              onCheckedChange={toggle}
              className="shrink-0"
              aria-label={`Enable ${document.name}`}
              title="On: expanded in every build. Off: a document that names it fails to build until it is switched back on."
            />
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-44">
          {actions.map((action) => (
            <React.Fragment key={action.key}>
              {action.separatorBefore && <ContextMenuSeparator />}
              <ContextMenuItem
                onClick={action.run}
                className={cn(
                  action.danger && 'text-destructive focus:text-destructive'
                )}
              >
                {action.label}
              </ContextMenuItem>
            </React.Fragment>
          ))}
        </ContextMenuContent>
      </ContextMenu>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent
          className="sm:max-w-[425px]"
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            buttonRef.current?.focus();
          }}
        >
          <DocumentFormDialogContentMemoized
            mode="update"
            shouldReset={!renameOpen}
            postSubmit={() => setRenameOpen(false)}
            selectedName={document.name}
            isPlugin
          />
        </DialogContent>
      </Dialog>
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent
          className="sm:max-w-[425px]"
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            buttonRef.current?.focus();
          }}
        >
          <DocumentFormDialogContentMemoized
            mode="delete"
            shouldReset={!deleteOpen}
            postSubmit={() => setDeleteOpen(false)}
            selectedName={document.name}
            isPlugin
          />
        </DialogContent>
      </Dialog>
    </li>
  );
}

const BrowserPluginRowMemoized = React.memo(BrowserPluginRow);

/**
 * Plugins are a per-run setting, not a file, so they sit last and start
 * folded: `2/7` in the eyebrow is the whole story until you need the switches.
 * Both halves of that ratio are counted by the caller, over everything it
 * knows about rather than over the rows a filter left standing — an eyebrow
 * that changed while you typed would be describing the query, not the run.
 *
 * Two origins share the section. Plugins written in the playground come
 * first — they are files too, and open in a tab — then the ones discovery
 * found on disk, which only have a switch and a details view.
 *
 * A deployment that will not load disk plugins (`pluginAutoload` off) still
 * lists them, with their switches disabled and a line saying why. Hiding them
 * would answer "where did the weather plugin go"; a live switch that changes
 * nothing answers nothing at all.
 */
export function PluginsSection({
  plugins,
  browserPlugins,
  query,
  open,
  onToggleSection,
  onShowPluginDetails,
  onNewPlugin,
  isPluginSelected,
  onTogglePlugin,
  isApplyingPlugins,
  diskPluginsLoadable,
  activeCount,
  totalCount,
}: {
  plugins: PluginMetadata[];
  /** Plugin files in the workspace, already filtered by the rail's query. */
  browserPlugins: TextFile[];
  query: string;
  open: boolean;
  onToggleSection: () => void;
  onShowPluginDetails: (name: string) => void;
  onNewPlugin: () => void;
  isPluginSelected: (name: string) => boolean;
  onTogglePlugin: (plugin: PluginMetadata) => void;
  isApplyingPlugins: boolean;
  /** Whether this server loads the disk plugins it discovered. */
  diskPluginsLoadable: boolean;
  /** Plugins on, and plugins there are — both unfiltered. */
  activeCount: number;
  totalCount: number;
}) {
  const showOrigins = plugins.length > 0 && browserPlugins.length > 0;

  return (
    <section className="border-sidebar-border/70 mt-3 border-t pt-2">
      <SectionLabel
        open={open}
        onToggle={onToggleSection}
        count={totalCount > 0 ? `${activeCount}/${totalCount}` : undefined}
        actions={
          <Tooltip>
            <TooltipTrigger asChild>
              <RailIconButton aria-label="New plugin" onClick={onNewPlugin}>
                <Plus />
              </RailIconButton>
            </TooltipTrigger>
            <TooltipContent side="bottom">New plugin</TooltipContent>
          </Tooltip>
        }
      >
        Plugins
      </SectionLabel>
      {open && (
        <div className="flex flex-col gap-0.5">
          {showOrigins && <OriginDivider>In this browser</OriginDivider>}
          <ul className="flex flex-col gap-0.5">
            {browserPlugins.map((doc) => (
              <BrowserPluginRowMemoized
                key={doc.name}
                document={doc}
                query={query}
              />
            ))}
          </ul>
          {showOrigins && <OriginDivider>On disk</OriginDivider>}
          {plugins.length > 0 && !diskPluginsLoadable && (
            <p className="text-sidebar-foreground/60 px-2 pt-0.5 pb-1 text-[11px] leading-snug">
              This server does not load plugins from disk, so these cannot be
              switched on. Set <code>PLUGIN_AUTOLOAD=true</code> on the
              deployment, or write one in the browser.
            </p>
          )}
          {plugins.map((plugin) => {
            const active = isPluginSelected(plugin.name) && diskPluginsLoadable;
            // Same identity the row key uses: two plugins discovered in
            // different locations can share a name, and a duplicate id would
            // point every `htmlFor` at the first switch.
            const switchId = `plugin-switch-${plugin.filePath || plugin.name}`;
            return (
              <div
                key={plugin.filePath || plugin.name}
                title={
                  plugin.description
                    ? `${plugin.name} — ${plugin.description}`
                    : plugin.name
                }
                className={cn(
                  'group/row flex h-7 w-full items-center gap-1 rounded-sm pr-1 pl-2',
                  'transition-colors hover:bg-sidebar-accent/60'
                )}
              >
                {/* The name opens the details, as a browser plugin's name
                    opens its file: one gesture for "show me this" across both
                    halves of the section. The switch keeps its own label. */}
                <button
                  type="button"
                  onClick={() => onShowPluginDetails(plugin.name)}
                  aria-label={`Details for ${plugin.name}`}
                  className={cn(
                    'flex h-7 min-w-0 flex-1 cursor-pointer items-center text-[13px]',
                    'focus-visible:ring-sidebar-ring rounded-sm focus-visible:ring-1 focus-visible:outline-none',
                    active
                      ? 'text-sidebar-foreground'
                      : 'text-sidebar-foreground/70'
                  )}
                >
                  <span className="truncate">
                    <HighlightedText text={plugin.name} query={query} />
                  </span>
                </button>
                <RailIconButton
                  aria-label={`Details for ${plugin.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onShowPluginDetails(plugin.name);
                  }}
                  className="opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100"
                >
                  <Info />
                </RailIconButton>
                <Switch
                  id={switchId}
                  checked={active}
                  onCheckedChange={() => onTogglePlugin(plugin)}
                  disabled={isApplyingPlugins || !diskPluginsLoadable}
                  className="shrink-0"
                  aria-label={`Toggle ${plugin.name} plugin`}
                  title={
                    diskPluginsLoadable
                      ? 'On: the server loads this plugin from disk for every build.'
                      : 'This server does not load plugins from disk (PLUGIN_AUTOLOAD is off).'
                  }
                />
              </div>
            );
          })}
          {plugins.length + browserPlugins.length === 0 && (
            <EmptyRow
              icon={Plus}
              label="New plugin"
              hint="Write a custom component in TypeScript, in the browser"
              onClick={onNewPlugin}
            />
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Splits a kind's on-disk files by where they were discovered, keeping
 * `current` ahead of `downstream` so the nearest files read first. The divider
 * only earns its row when a kind spans both.
 */
export function useLocationGroups<T extends { location: string }>(
  items: T[]
): Array<[string, T[]]> {
  return useMemo(() => {
    const order = ['current', 'downstream'];
    const groups = new Map<string, T[]>();
    items.forEach((item) => {
      const bucket = groups.get(item.location);
      if (bucket) bucket.push(item);
      else groups.set(item.location, [item]);
    });
    return [...groups.entries()].sort(
      ([a], [b]) => order.indexOf(a) - order.indexOf(b)
    );
  }, [items]);
}
