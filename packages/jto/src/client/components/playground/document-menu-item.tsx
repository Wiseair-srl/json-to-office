import React, {
  useCallback,
  useRef,
  useState,
  useMemo,
  useEffect,
} from 'react';
import { FileTextIcon, PaletteIcon, PlayCircle } from 'lucide-react';
import { DocumentFormDialogContentMemoized } from './document-form-dialog-content';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '../ui/context-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { Dialog, DialogContent } from '../ui/dialog';
import { SidebarMenuButton, SidebarMenuItem } from '../ui/sidebar';
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

function DocumentMenuItem({
  document,
  indicator: _indicator,
  compact = false,
}: {
  document: TextFile;
  indicator?: 'in-use';
  compact?: boolean;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [isContextMenuOpen, setIsContextMenuOpen] = useState<boolean>(false);
  const [isRenameDialogOpen, setIsRenameDialogOpen] = useState<boolean>(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState<boolean>(false);
  const { openDocument, documentTypes, activeTab } = useDocumentsStore(
    (state) => state
  );
  const {
    name: previewDocumentName,
    text: previewText,
    isGenerating,
  } = useOutputStore((state) => state);

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
  }, [
    isTheme,
    persistentPreviewText,
    document.text,
    document.name,
    persistentPreviewName,
  ]);

  const closeRenameDialog = useCallback(() => {
    setIsRenameDialogOpen(false);
  }, []);

  const closeDeleteDialog = useCallback(() => {
    setIsDeleteDialogOpen(false);
  }, []);

  const button = (
    <SidebarMenuButton
      variant="default"
      size="default"
      ref={buttonRef}
      className={cn(
        'text-sidebar-foreground focus:bg-accent focus:text-accent-foreground w-full',
        compact ? 'justify-center px-1' : 'justify-start gap-2',
        isContextMenuOpen && 'bg-accent text-accent-foreground', // because will lose focus/style
        // Priority order for background highlighting: Editing > Previewing Document > Theme Used in Preview
        isEditing &&
          (compact
            ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300'
            : 'bg-green-50 border-l-2 border-green-500 text-green-700 dark:bg-green-900/20 dark:border-green-400 dark:text-green-300'),
        isPreviewing &&
          !isEditing &&
          (compact
            ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300'
            : 'bg-blue-50 border-l-2 border-blue-500 text-blue-700 dark:bg-blue-900/20 dark:border-blue-400 dark:text-blue-300'),
        isThemeUsedInPreview &&
          !isEditing &&
          !isPreviewing &&
          (compact
            ? 'bg-purple-50 text-purple-700 dark:bg-purple-900/20 dark:text-purple-300'
            : 'bg-purple-50 border-l-2 border-purple-500 text-purple-700 dark:bg-purple-900/20 dark:border-purple-400 dark:text-purple-300')
      )}
      title={document.name}
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
      {isEditing ? (
        <PlayCircle
          className={cn('size-4', 'text-green-600 dark:text-green-400')}
        />
      ) : isPreviewing ? (
        <PlayCircle
          className={cn('size-4', 'text-blue-600 dark:text-blue-400')}
        />
      ) : isTheme ? (
        <PaletteIcon className="size-4 text-purple-600 dark:text-purple-400" />
      ) : (
        <FileTextIcon className="size-4 text-blue-600 dark:text-blue-400" />
      )}
      {!compact && (
        <span
          className={cn(
            'truncate flex-1',
            isTheme &&
              !isEditing &&
              !isPreviewing &&
              !isThemeUsedInPreview &&
              'text-purple-700 dark:text-purple-300',
            (isEditing || isPreviewing || isThemeUsedInPreview) && 'font-medium'
          )}
        >
          {document.name}
        </span>
      )}
    </SidebarMenuButton>
  );

  return (
    <SidebarMenuItem>
      <ContextMenu onOpenChange={setIsContextMenuOpen}>
        <ContextMenuTrigger>
          {compact ? (
            <Tooltip>
              <TooltipTrigger asChild>{button}</TooltipTrigger>
              <TooltipContent side="right">
                <div className="text-xs">
                  {document.name}
                  {isTheme ? (
                    <div className="opacity-70">Theme</div>
                  ) : (
                    <div className="opacity-70">Document</div>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>
          ) : (
            button
          )}
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={() => openDocument(document.name)}>
            Open
            <ContextMenuShortcut>{isMac ? '⌘⏎' : '⌃⏎'}</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            disabled={!document}
            onClick={() => {
              if (document)
                download(
                  document.name,
                  new Blob([document.text], { type: document.type })
                );
            }}
          >
            Download...
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => setIsRenameDialogOpen(true)}>
            Rename...
            <ContextMenuShortcut>⏎</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onClick={() => setIsDeleteDialogOpen(true)}>
            Delete
            <ContextMenuShortcut>⌫</ContextMenuShortcut>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
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
