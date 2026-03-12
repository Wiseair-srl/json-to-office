import React, { useCallback, useEffect, useRef } from 'react';
import { useTheme } from '../theme-provider';
import { constrainedEditor } from 'constrained-editor-plugin';
import MonacoEditor, { Monaco, DiffEditor } from '@monaco-editor/react';
import type { editor as MonacoEditorType } from 'monaco-editor';
import type { TextFile } from '../../lib/types';
import { validateThemeJson } from '../../lib/theme-validation';
import { createThemeSchemaConfig } from '../../lib/json-schema-generator';
import { useDocumentsStore } from '../../store/documents-store-provider';
import { Button } from '../ui/button';
import { useEditorRefsStore } from '../../store/editor-refs-store';
import {
  getSelectionContext,
  createContextSnippet,
} from '../../lib/monaco-selection-utils';

/**
 * EditorMonacoTheme component for editing JSON theme files with schema validation
 */
function EditorMonacoTheme({
  document,
  readOnly = false,
  onChange,
}: {
  document: TextFile;
  readOnly?: boolean;
  onChange?: (value: string) => void;
}) {
  const editorRef = useRef<MonacoEditorType.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const modelRef = useRef<MonacoEditorType.ITextModel | null>(null);
  const { theme } = useTheme();
  const [isReady, setIsReady] = React.useState(false);
  const pendingDiff = useDocumentsStore((s) => s.pendingDiffs[document.name]);
  const clearPendingDiff = useDocumentsStore((s) => s.clearPendingDiff);
  const saveDocument = useDocumentsStore((s) => s.saveDocument);
  const { registerEditor, unregisterEditor, setActiveEditor } =
    useEditorRefsStore();

  // Get resolved theme - convert 'system' to actual theme
  const resolvedTheme =
    theme === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : theme;

  // Initialize Monaco editor
  const handleEditorWillMount = useCallback((monaco: Monaco) => {
    console.log('Monaco theme editor will mount');
    monacoRef.current = monaco;

    // Configure JSON defaults with theme schema
    const schemaConfig = createThemeSchemaConfig();
    monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
      validate: true,
      schemas: [schemaConfig],
    });

    setIsReady(true);
  }, []);

  // Handle editor mount
  const handleEditorMount = useCallback(
    (editor: MonacoEditorType.IStandaloneCodeEditor, monaco: Monaco) => {
      editorRef.current = editor;
      modelRef.current = editor.getModel();

      // Register editor in the refs store
      registerEditor(document.name, editor, monaco);
      setActiveEditor(document.name);

      // Enable constrained editing
      const constrainedInstance = constrainedEditor(monaco);
      const model = editor.getModel();
      if (model) {
        constrainedInstance.initializeIn(editor);
      }

      // Configure editor options
      editor.updateOptions({
        formatOnType: true,
        formatOnPaste: true,
        automaticLayout: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: true,
        wordWrap: 'on',
        folding: true,
        foldingStrategy: 'indentation',
        suggest: {
          showColors: true,
          showConstants: true,
          showEnums: true,
          showFields: true,
          showFunctions: true,
          showKeywords: true,
          showModules: true,
          showProperties: true,
          showSnippets: true,
          showStructs: true,
          showTypeParameters: true,
          showUnits: true,
          showValues: true,
          showVariables: true,
        },
      });

      // Add keyboard shortcuts
      // Cmd+K => send selection to AI assistant
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, () => {
        const selection = getSelectionContext(editor, monaco);
        if (selection) {
          const snippet = createContextSnippet(selection);
          window.dispatchEvent(
            new CustomEvent('monaco-selection-to-ai', {
              detail: {
                documentName: document.name,
                selection,
                snippet,
                isTheme: true,
              },
            })
          );
        }
      });

      // Cmd+S => save command
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        // Save command - parent component handles this
        console.log('Save command triggered in theme editor');
      });

      // Add context menu action for AI assistant
      editor.addAction({
        id: 'send-theme-to-ai-assistant',
        label: 'Send to AI Assistant (⌘K)',
        contextMenuGroupId: 'navigation',
        contextMenuOrder: 1.5,
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK],
        run: function () {
          // Use the editor reference from closure instead of the parameter
          const selection = getSelectionContext(editor, monaco);
          if (selection) {
            const snippet = createContextSnippet(selection);
            // Dispatch event for the chat panel to capture
            window.dispatchEvent(
              new CustomEvent('monaco-selection-to-ai', {
                detail: {
                  documentName: document.name,
                  selection,
                  snippet,
                  isTheme: true,
                },
              })
            );
          }
        },
      });

      // Format document on mount
      setTimeout(() => {
        editor.getAction('editor.action.formatDocument')?.run();
      }, 100);

      console.log('Monaco theme editor mounted');
    },
    [document.name, registerEditor, setActiveEditor]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      unregisterEditor(document.name);
    };
  }, [document.name, unregisterEditor]);

  // Handle content changes
  const handleChange = useCallback(
    (
      value: string | undefined,
      _event: MonacoEditorType.IModelContentChangedEvent
    ) => {
      if (value !== undefined && onChange) {
        onChange(value);
      }
    },
    [onChange]
  );

  // Validate theme content
  useEffect(() => {
    if (
      !editorRef.current ||
      !monacoRef.current ||
      !modelRef.current ||
      !isReady
    ) {
      return;
    }

    const monaco = monacoRef.current;
    const model = modelRef.current;

    // Clear existing markers
    monaco.editor.setModelMarkers(model, 'theme-validation', []);

    // Validate theme JSON
    const validationResult = validateThemeJson(document.text);
    if (!validationResult.valid && validationResult.errors) {
      const markers = validationResult.errors.map((error) => ({
        severity: monaco.MarkerSeverity.Error,
        startLineNumber: error.line || 1,
        startColumn: error.column || 1,
        endLineNumber: error.line || 1,
        endColumn: error.column || 1000,
        message: error.message,
        source: 'theme-validation',
      }));

      monaco.editor.setModelMarkers(model, 'theme-validation', markers);
    }
  }, [document.text, isReady]);

  // Update theme
  useEffect(() => {
    if (editorRef.current) {
      const newTheme = resolvedTheme === 'dark' ? 'vs-dark' : 'vs';
      editorRef.current.updateOptions({ theme: newTheme });
    }
  }, [resolvedTheme]);

  return (
    <div className="relative h-full">
      {pendingDiff ? (
        <>
          <div className="flex items-center justify-between px-2 py-1 border-b bg-muted/40 text-xs">
            <div>
              Review changes for{' '}
              <span className="font-medium">{document.name}</span>
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => clearPendingDiff(document.name)}
              >
                Discard
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  saveDocument(document.name, pendingDiff.modified);
                  clearPendingDiff(document.name, true);
                }}
              >
                Apply Changes
              </Button>
            </div>
          </div>
          <DiffEditor
            height="calc(100% - 32px)"
            original={pendingDiff.original}
            modified={pendingDiff.modified}
            language="json"
            theme={resolvedTheme === 'dark' ? 'vs-dark' : 'vs'}
            options={{
              readOnly: true,
              renderSideBySide: true,
              originalEditable: false,
              automaticLayout: true,
              minimap: { enabled: false },
            }}
            beforeMount={handleEditorWillMount}
          />
        </>
      ) : (
        <MonacoEditor
          height="100%"
          language="json"
          value={document.text}
          theme={resolvedTheme === 'dark' ? 'vs-dark' : 'vs'}
          onChange={handleChange}
          beforeMount={handleEditorWillMount}
          onMount={handleEditorMount}
          options={{
            readOnly,
            lineNumbers: 'on',
            glyphMargin: true,
            folding: true,
            lineDecorationsWidth: 5,
            lineNumbersMinChars: 3,
            renderValidationDecorations: 'on',
            quickSuggestions: {
              other: true,
              comments: false,
              strings: true,
            },
            acceptSuggestionOnCommitCharacter: true,
            acceptSuggestionOnEnter: 'on',
            accessibilitySupport: 'auto',
            autoIndent: 'advanced',
            formatOnType: true,
            formatOnPaste: true,
            automaticLayout: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: true,
            wordWrap: 'on',
          }}
        />
      )}
    </div>
  );
}

export const EditorMonacoThemeMemoized = React.memo(EditorMonacoTheme);
