import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTheme } from '../theme-provider';
import { constrainedEditor } from 'constrained-editor-plugin';
import MonacoEditor, { Monaco, DiffEditor } from '@monaco-editor/react';
import type { editor as MonacoEditorType } from 'monaco-editor';
import type { TextFile } from '../../lib/types';
import { type JsonEditorError } from '../../lib/json-types';
import { FORMAT } from '../../lib/env';
import { useDocumentsStore } from '../../store/documents-store-provider';
import { Button } from '../ui/button';
import { useEditorRefsStore } from '../../store/editor-refs-store';
import {
  getSelectionContext,
  createContextSnippet,
} from '../../lib/monaco-selection-utils';
import { ValidationPanel, ValidationStatusBar } from './validation-panel';

/** Ensure defaultPath matches the schema fileMatch pattern (*.FORMAT.theme.json) */
function resolveThemeDefaultPath(name: string): string {
  const ext = `.${FORMAT}.theme.json`;
  if (name.endsWith(ext)) return name;
  const base = name
    .replace(/\.\w+\.theme\.json$/, '')
    .replace(/\.theme\.json$/, '')
    .replace(/\.json$/, '');
  return base + ext;
}

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
  const [validationErrors, setValidationErrors] = useState<JsonEditorError[]>(
    []
  );
  const [showValidationPanel, setShowValidationPanel] = useState(true);
  const [isValidationPanelMinimized, setIsValidationPanelMinimized] =
    useState(false);
  const userDismissedRef = useRef(false);
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
    monacoRef.current = monaco;
    // Don't call setDiagnosticsOptions here — it would clobber the global
    // config. The theme schema is already registered by configureMonacoInstance
    // and matched via defaultPath → fileMatch.
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

  // Handle Monaco's built-in schema validation markers
  const handleEditorValidation = useCallback(
    (markers: MonacoEditorType.IMarker[]) => {
      const errors: JsonEditorError[] = markers.map((marker) => ({
        path: '',
        message: marker.message,
        code:
          typeof marker.code === 'string'
            ? marker.code
            : marker.code?.value || 'validation_error',
        startLineNumber: marker.startLineNumber,
        startColumn: marker.startColumn,
        endLineNumber: marker.endLineNumber,
        endColumn: marker.endColumn,
        severity:
          marker.severity >= 8
            ? 'error'
            : marker.severity >= 4
              ? 'warning'
              : 'info',
      }));

      setValidationErrors(errors);

      if (errors.length > 0 && !userDismissedRef.current) {
        setShowValidationPanel(true);
        setIsValidationPanelMinimized(false);
      }
      if (errors.length === 0) {
        userDismissedRef.current = false;
      }
    },
    []
  );

  const handleErrorClick = useCallback((error: JsonEditorError) => {
    if (editorRef.current && error.startLineNumber && error.startColumn) {
      editorRef.current.setPosition({
        lineNumber: error.startLineNumber,
        column: error.startColumn,
      });
      editorRef.current.revealLineInCenter(error.startLineNumber);
      editorRef.current.focus();
    }
  }, []);

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
          defaultPath={resolveThemeDefaultPath(document.name)}
          value={document.text}
          theme={resolvedTheme === 'dark' ? 'vs-dark' : 'vs'}
          onChange={handleChange}
          beforeMount={handleEditorWillMount}
          onMount={handleEditorMount}
          onValidate={handleEditorValidation}
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

      {/* Validation Status Bar */}
      <div className="absolute top-0 right-0">
        <ValidationStatusBar
          errors={validationErrors}
          onClick={() => {
            setShowValidationPanel(true);
            setIsValidationPanelMinimized(false);
          }}
        />
      </div>

      {/* Validation Panel */}
      {showValidationPanel && validationErrors.length > 0 && (
        <ValidationPanel
          errors={validationErrors}
          isMinimized={isValidationPanelMinimized}
          onToggleMinimize={() =>
            setIsValidationPanelMinimized(!isValidationPanelMinimized)
          }
          onErrorClick={handleErrorClick}
          onClose={() => {
            setShowValidationPanel(false);
            userDismissedRef.current = true;
          }}
          className="z-40"
        />
      )}
    </div>
  );
}

export const EditorMonacoThemeMemoized = React.memo(EditorMonacoTheme);
