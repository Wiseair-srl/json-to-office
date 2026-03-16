import React from 'react';
import { EditorMonacoJsonMemoized } from '../json-editor/editor-monaco-json';
import { EditorMonacoThemeMemoized } from '../json-editor/editor-monaco-theme';
import { TabsContent } from '../ui/tabs';
import { useDocumentsStore } from '../../store/documents-store-provider';
import { useThemesStore } from '../../store/themes-store-provider';
import type { TextFile } from '../../lib/types';
import type { DocumentType } from '../../store/documents-store';
import debounce from 'lodash.debounce';

function TabContent({
  name,
  text,
  buildError: _buildError,
  saveDocumentDebounceWait,
  documentType,
}: {
  name: string;
  text: string;
  buildError?: string;
  saveDocumentDebounceWait: number;
  documentType: DocumentType;
}) {
  const { saveDocument } = useDocumentsStore((state) => state);
  const { updateTheme } = useThemesStore((state) => state);

  // Create a debounced version of updateTheme
  const debouncedUpdateTheme = React.useMemo(
    () => debounce(updateTheme, saveDocumentDebounceWait),
    [updateTheme, saveDocumentDebounceWait]
  );

  // Flush pending theme updates on unmount so the themes store is always
  // up-to-date when the user switches away from a theme tab.
  React.useEffect(() => {
    return () => {
      debouncedUpdateTheme.flush();
    };
  }, [debouncedUpdateTheme]);

  const handleChange = React.useCallback(
    (value: string) => {
      saveDocument(name, value);

      // If this is a theme document, update the themes store with debouncing
      if (documentType === 'application/json+theme') {
        console.log(
          'TabContent: Theme document change detected, debouncing update',
          {
            documentName: name,
            debounceWait: saveDocumentDebounceWait,
          }
        );
        debouncedUpdateTheme(name, value);
      }
    },
    [
      name,
      saveDocument,
      debouncedUpdateTheme,
      documentType,
      saveDocumentDebounceWait,
    ]
  );

  // Create a fake document object for the theme editor
  const document: TextFile = React.useMemo(
    () => ({
      name,
      type: 'application/json',
      text,
      mtime: new Date(),
      ctime: new Date(),
      atime: new Date(),
    }),
    [name, text]
  );

  return (
    <TabsContent
      value={name}
      className="mt-0 h-full p-0"
      tabIndex={-1} // to prevent focus on Tab trigger (fix for accessibility size issue)
    >
      {documentType === 'application/json+theme' ? (
        <EditorMonacoThemeMemoized
          document={document}
          onChange={handleChange}
        />
      ) : (
        <EditorMonacoJsonMemoized
          name={name}
          value={text}
          saveDocumentDebounceWait={saveDocumentDebounceWait}
        />
      )}
    </TabsContent>
  );
}

const TabContentMemoized = React.memo(TabContent);

function EditorTabsContent({
  openTabs,
  documents,
  buildErrors,
  saveDocumentDebounceWait,
}: {
  openTabs: string[];
  documents: TextFile[];
  buildErrors: Record<string, string>;
  saveDocumentDebounceWait: number;
}) {
  const { documentTypes } = useDocumentsStore((state) => state);

  return openTabs
    .map((name) => documents.find((d) => d.name === name))
    .filter((doc): doc is TextFile => doc !== undefined)
    .map((doc) => {
      const documentType = documentTypes[doc.name] || 'application/json+report';

      return (
        <TabContentMemoized
          key={doc.name}
          name={doc.name}
          text={doc.text}
          buildError={buildErrors[doc.name]}
          saveDocumentDebounceWait={saveDocumentDebounceWait}
          documentType={documentType}
        />
      );
    });
}

export const EditorTabsContentMemoized = React.memo(EditorTabsContent);
