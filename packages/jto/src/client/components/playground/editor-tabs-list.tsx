import React from 'react';
import { XIcon, FileTextIcon, PaletteIcon } from 'lucide-react';
import { buttonVariants } from '../ui/button';
import { TabsList, TabsTrigger } from '../ui/tabs';
import { useDocumentsStore } from '../../store/documents-store-provider';
import { cn } from '../../lib/utils';

function EditorTabItem({ name }: { name: string }) {
  const { closeDocument, documentTypes } = useDocumentsStore((state) => state);
  const documentType = documentTypes[name] || 'application/json+report';
  const isTheme = documentType === 'application/json+theme';

  return (
    <TabsTrigger
      value={name}
      key={name}
      autoFocus={false}
      className="h-9 gap-x-2 border px-2 focus-visible:h-9 focus-visible:ring-1 focus-visible:ring-offset-0"
      onKeyDown={(e) => {
        // if delete or backspace is pressed => close the document
        if (e.key === 'Delete' || e.key === 'Backspace') {
          closeDocument(name);
          e.preventDefault();
        }
      }}
    >
      {isTheme ? (
        <PaletteIcon className="size-4 text-purple-600 dark:text-purple-400" />
      ) : (
        <FileTextIcon className="size-4 text-blue-600 dark:text-blue-400" />
      )}
      <span
        className={cn(
          'truncate',
          isTheme && 'text-purple-700 dark:text-purple-300'
        )}
      >
        {name}
      </span>
      <XIcon
        className={cn(
          buttonVariants({ variant: 'ghost', size: 'icon' }),
          'text-sidebar-accent-foreground size-6'
        )}
        onPointerDown={(e) => {
          closeDocument(name);
          e.preventDefault();
        }}
      />
    </TabsTrigger>
  );
}

const EditorTabItemMemoized = React.memo(EditorTabItem);

function EditorTabsList({ openTabs }: { openTabs: string[] }) {
  return (
    <TabsList className="bg-sidebar text-sidebar-foreground h-10 w-full justify-start gap-x-0.5 rounded-none border-b">
      {openTabs.map((docName) => (
        <EditorTabItemMemoized key={docName} name={docName} />
      ))}
    </TabsList>
  );
}

export const EditorTabsListMemoized = React.memo(EditorTabsList);
