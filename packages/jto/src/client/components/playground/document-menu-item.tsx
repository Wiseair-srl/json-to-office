import React, {
  useCallback,
  useRef,
  useState,
  useMemo,
  useEffect,
} from 'react';
import { FileTextIcon, PaletteIcon, MoreHorizontal } from 'lucide-react';
import { DocumentFormDialogContentMemoized } from './document-form-dialog-content';
import { HighlightedText, StatusDot } from './sidebar-shared';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '../ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { Dialog, DialogContent } from '../ui/dialog';
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from '../ui/sidebar';
import { useDocumentsStore } from '../../store/documents-store-provider';
import { useOutputStore } from '../../store/output-store-provider';
import { download } from '../../lib/download';
import type { TextFile } from '../../lib/types';
import { cn } from '../../lib/utils';
import { getThemeName } from '../../lib/theme-validation';

const isMac: boolean =
  typeof window !== 'undefined'
    ? navigator.userAgent.toUpperCase().indexOf('MAC') >= 0
    : false;

type RowAction = {
  key: string;
  label: string;
  shortcut?: string;
  separatorBefore?: boolean;
  danger?: boolean;
  run: () => void;
};

/**
 * One open file in the rail.
 *
 * Three states have to read at a glance, and only one of them gets a filled
 * bed: the row you are editing. Preview and theme-in-use are marked with a
 * 6px dot on the trailing edge instead. The file icon never changes — swapping
 * it for a state glyph costs you the only cue that says document vs theme.
 */
function DocumentMenuItem({
  document,
  compact = false,
  query = '',
}: {
  document: TextFile;
  compact?: boolean;
  query?: string;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [isContextMenuOpen, setIsContextMenuOpen] = useState<boolean>(false);
  const [isActionMenuOpen, setIsActionMenuOpen] = useState<boolean>(false);
  const [isRenameDialogOpen, setIsRenameDialogOpen] = useState<boolean>(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState<boolean>(false);

  // Narrow selectors: this component is rendered once per file, so subscribing
  // to the whole store would re-render the entire rail on every keystroke.
  const openDocument = useDocumentsStore((state) => state.openDocument);
  const documentTypes = useDocumentsStore((state) => state.documentTypes);
  const activeTab = useDocumentsStore((state) => state.activeTab);

  const previewDocumentName = useOutputStore((state) => state.name);
  const previewText = useOutputStore((state) => state.text);
  const isGenerating = useOutputStore((state) => state.isGenerating);

  const documentType =
    documentTypes[document.name] || 'application/json+report';
  const isTheme = documentType === 'application/json+theme';
  const isEditing = activeTab === document.name;

  // Persistent preview state that survives temporary null values during rebuilds
  const [persistentPreviewName, setPersistentPreviewName] =
    useState(previewDocumentName);
  const [persistentPreviewText, setPersistentPreviewText] =
    useState(previewText);

  // Constants for timing delays
  const GENERATION_UPDATE_DELAY = 100; // ms - delay during generation to prevent flicker
  const IMMEDIATE_UPDATE = 0; // ms - immediate update when not generating

  // Update persistent state for both name and text together to maintain consistency
  useEffect(() => {
    const timeoutId = setTimeout(
      () => {
        if (previewDocumentName && previewText) {
          // Both values available - update both immediately
          setPersistentPreviewName(previewDocumentName);
          setPersistentPreviewText(previewText);
        } else if (!isGenerating) {
          // Generation is done and we have no values - clear both
          setPersistentPreviewName('');
          setPersistentPreviewText('');
        }
        // If generating and missing values, keep the last known state for both
      },
      isGenerating ? GENERATION_UPDATE_DELAY : IMMEDIATE_UPDATE
    );

    return () => clearTimeout(timeoutId);
  }, [previewDocumentName, previewText, isGenerating]);

  const isPreviewing = persistentPreviewName === document.name;

  // Function to extract theme names from document JSON
  const getThemeNamesFromDocument = (documentText: string): Set<string> => {
    const themes = new Set<string>();
    try {
      const parsed = JSON.parse(documentText);

      // Check root level props.theme (main pattern)
      if (parsed.props?.theme) {
        themes.add(parsed.props.theme);
      }

      // Also check for themes in report components (backup pattern from original code)
      if (parsed.children && Array.isArray(parsed.children)) {
        parsed.children.forEach(
          (component: { name?: string; props?: { theme?: string } }) => {
            if (component.name === 'docx' && component.props?.theme) {
              themes.add(component.props.theme);
            }
          }
        );
      }
    } catch {
      // Ignore parse errors
    }
    return themes;
  };

  // Check if this theme is used in the currently previewed document
  // Use persistent preview text to prevent flickering during theme rebuilds
  const isThemeUsedInPreview = useMemo(() => {
    if (!isTheme || !persistentPreviewText) return false;
    try {
      const parsed = JSON.parse(document.text);
      const themeName = getThemeName(parsed);
      if (themeName) {
        const previewThemes = getThemeNamesFromDocument(persistentPreviewText);
        return previewThemes.has(themeName);
      }
    } catch {
      // Ignore errors
    }
    return false;
  }, [isTheme, persistentPreviewText, document.text]);

  const closeRenameDialog = useCallback(() => {
    setIsRenameDialogOpen(false);
  }, []);

  const closeDeleteDialog = useCallback(() => {
    setIsDeleteDialogOpen(false);
  }, []);

  // The dot is suppressed on the active row — that row already carries the
  // accent bed, and a marker on top of it says nothing new.
  const dotTone: 'preview' | 'in-use' | null = isEditing
    ? null
    : isPreviewing
      ? 'preview'
      : isThemeUsedInPreview
        ? 'in-use'
        : null;

  const stateLabel = isEditing
    ? 'Editing'
    : isPreviewing
      ? 'In preview'
      : isThemeUsedInPreview
        ? 'Used by preview'
        : null;

  const actions: RowAction[] = useMemo(
    () => [
      {
        key: 'open',
        label: 'Open',
        shortcut: isMac ? '⌘⏎' : '⌃⏎',
        run: () => openDocument(document.name),
      },
      {
        key: 'download',
        label: 'Download…',
        separatorBefore: true,
        run: () =>
          download(
            document.name,
            new Blob([document.text], { type: document.type })
          ),
      },
      {
        key: 'rename',
        label: 'Rename…',
        shortcut: '⏎',
        separatorBefore: true,
        run: () => setIsRenameDialogOpen(true),
      },
      {
        key: 'delete',
        label: 'Delete',
        shortcut: '⌫',
        danger: true,
        run: () => setIsDeleteDialogOpen(true),
      },
    ],
    [document.name, document.text, document.type, openDocument]
  );

  const Icon = isTheme ? PaletteIcon : FileTextIcon;
  const menuOpen = isContextMenuOpen || isActionMenuOpen;

  const button = (
    <SidebarMenuButton
      size="sm"
      ref={buttonRef}
      aria-label={
        stateLabel ? `${document.name} — ${stateLabel}` : document.name
      }
      className={cn(
        'relative h-7 rounded-sm text-[13px] font-normal',
        'text-sidebar-foreground/85 transition-colors',
        'hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
        compact ? 'size-7 justify-center px-0' : 'gap-2 pr-7 pl-2',
        // Keep the hover bed while a menu is open — the row loses focus to the
        // popover and would otherwise flick back to its resting state.
        menuOpen && 'bg-sidebar-accent/60 text-sidebar-foreground',
        // The one filled bed in the panel, plus the stripe. The stripe is
        // status, not ornament: it only ever means "this is what the editor
        // has open".
        isEditing &&
          'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
      )}
      title={stateLabel ? `${document.name} — ${stateLabel}` : document.name}
      onClick={() => {
        openDocument(document.name);
      }}
      onKeyDown={(e: React.KeyboardEvent<HTMLButtonElement>) => {
        // keyboard shortcuts
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          // ⌘Cmd/⌃Ctrl + Enter => Open in editor
          openDocument(document.name);
          e.preventDefault();
        } else if (e.key === 'Enter') {
          // Enter => Rename
          setIsRenameDialogOpen(true);
          e.preventDefault();
        } else if (e.key === 'Backspace' || e.key === 'Delete') {
          // ⌫ or ␡ or ⌦ Delete => Delete
          setIsDeleteDialogOpen(true);
          e.preventDefault();
        } else if (e.key === 'Escape') {
          // Escape => Unselect
          buttonRef.current?.blur();
          e.preventDefault();
        }
      }}
    >
      {isEditing && (
        <span
          aria-hidden
          className={cn(
            'bg-primary absolute top-1 bottom-1 left-0 w-[2px] rounded-full',
            compact && 'top-1.5 bottom-1.5'
          )}
        />
      )}
      <Icon
        className={cn(
          'size-3.5 shrink-0',
          isTheme ? 'text-accent2' : 'text-sidebar-foreground/60',
          isEditing && !isTheme && 'text-sidebar-accent-foreground/70'
        )}
      />
      {!compact && (
        <span className="flex-1 truncate">
          <HighlightedText text={document.name} query={query} />
        </span>
      )}
      {compact && dotTone && (
        <StatusDot
          tone={dotTone}
          className="absolute top-1 right-1 size-1.5 ring-2 ring-[hsl(var(--sidebar))]"
        />
      )}
    </SidebarMenuButton>
  );

  return (
    <SidebarMenuItem>
      <ContextMenu onOpenChange={setIsContextMenuOpen}>
        <ContextMenuTrigger className="block">
          {compact ? (
            <Tooltip>
              <TooltipTrigger asChild>{button}</TooltipTrigger>
              <TooltipContent side="right">
                <div className="text-xs">
                  <div>{document.name}</div>
                  <div className="opacity-70">
                    {stateLabel ?? (isTheme ? 'Theme' : 'Document')}
                  </div>
                </div>
              </TooltipContent>
            </Tooltip>
          ) : (
            button
          )}
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
                {action.shortcut && (
                  <ContextMenuShortcut>{action.shortcut}</ContextMenuShortcut>
                )}
              </ContextMenuItem>
            </React.Fragment>
          ))}
        </ContextMenuContent>
      </ContextMenu>

      {/* Trailing slot. The dot rests here; hovering or focusing the row swaps
          it for the overflow menu, so rename/download/delete stop being
          right-click-only secrets. */}
      {!compact && (
        <>
          {dotTone && (
            <StatusDot
              tone={dotTone}
              className={cn(
                'pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 transition-opacity',
                'group-hover/menu-item:opacity-0 group-focus-within/menu-item:opacity-0',
                isActionMenuOpen && 'opacity-0'
              )}
            />
          )}
          <DropdownMenu onOpenChange={setIsActionMenuOpen}>
            <DropdownMenuTrigger asChild>
              <SidebarMenuAction
                showOnHover
                aria-label={`Actions for ${document.name}`}
                className="top-1 size-5 rounded-sm text-sidebar-foreground/55 hover:text-sidebar-foreground [&>svg]:size-3.5"
              >
                <MoreHorizontal />
              </SidebarMenuAction>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="start" className="w-44">
              {actions.map((action) => (
                <React.Fragment key={action.key}>
                  {action.separatorBefore && <DropdownMenuSeparator />}
                  <DropdownMenuItem
                    onClick={action.run}
                    className={cn(
                      action.danger && 'text-destructive focus:text-destructive'
                    )}
                  >
                    {action.label}
                    {action.shortcut && (
                      <DropdownMenuShortcut>
                        {action.shortcut}
                      </DropdownMenuShortcut>
                    )}
                  </DropdownMenuItem>
                </React.Fragment>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}

      <Dialog open={isRenameDialogOpen} onOpenChange={setIsRenameDialogOpen}>
        <DialogContent
          className="sm:max-w-[425px]"
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            buttonRef.current?.focus();
          }}
        >
          <DocumentFormDialogContentMemoized
            mode="update"
            shouldReset={!isRenameDialogOpen}
            postSubmit={closeRenameDialog}
            selectedName={document.name}
          />
        </DialogContent>
      </Dialog>
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent
          className="sm:max-w-[425px]"
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            buttonRef.current?.focus();
          }}
        >
          <DocumentFormDialogContentMemoized
            mode="delete"
            shouldReset={!isDeleteDialogOpen}
            postSubmit={closeDeleteDialog}
            selectedName={document.name}
          />
        </DialogContent>
      </Dialog>
    </SidebarMenuItem>
  );
}

export const DocumentMenuItemMemoized = React.memo(DocumentMenuItem);
