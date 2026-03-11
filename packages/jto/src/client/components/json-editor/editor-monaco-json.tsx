import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useTheme } from '../theme-provider';
import Editor, { Monaco, DiffEditor } from '@monaco-editor/react';
import debounce from 'lodash.debounce';
import type { editor } from 'monaco-editor';
import { useDocumentsStore } from '../../store/documents-store-provider';
import { useOutputStore } from '../../store/output-store-provider';
import { Button } from '../ui/button';
import { type JsonEditorError } from '../../lib/json-types';
import { configureMonacoInstance } from '../../lib/monaco-config';
import { useEditorRefsStore } from '../../store/editor-refs-store';
import {
  getSelectionContext,
  createContextSnippet,
} from '../../lib/monaco-selection-utils';
import { ValidationPanel, ValidationStatusBar } from './validation-panel';

interface EditorMonacoJsonProps {
  name: string;
  defaultValue?: string;
  value?: string; // when provided, the editor becomes controlled
  saveDocumentDebounceWait: number;
}

function EditorMonacoJson({
  name,
  defaultValue,
  value,
  saveDocumentDebounceWait,
}: EditorMonacoJsonProps) {
  console.debug(`Render EditorMonacoJson (name: ${name})`);

  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const { resolvedTheme } = useTheme();
  const saveDocument = useDocumentsStore((state) => state.saveDocument);
  const bumpEditSequence = useOutputStore((state) => state.bumpEditSequence);
  const closeDocument = useDocumentsStore((state) => state.closeDocument);
  const pendingDiff = useDocumentsStore((state) => state.pendingDiffs[name]);
  const clearPendingDiff = useDocumentsStore((state) => state.clearPendingDiff);
  const [validationErrors, setValidationErrors] = useState<JsonEditorError[]>(
    []
  );
  const [showValidationPanel, setShowValidationPanel] = useState(true);
  const [isValidationPanelMinimized, setIsValidationPanelMinimized] =
    useState(false);
  const decorationIdsRef = useRef<string[]>([]);
  const { registerEditor, unregisterEditor, setActiveEditor } =
    useEditorRefsStore();

  const debouncedSaveDocumentRef = useRef(
    debounce(saveDocument, saveDocumentDebounceWait)
  );

  // Setup Monaco editor for JSON with schema validation
  const handleEditorWillMount = useCallback((monaco: Monaco) => {
    console.debug('Setting up Monaco for JSON editor');

    // Enhanced error styles removed - using Monaco's native styling

    // Ensure Monaco is configured with schemas
    configureMonacoInstance(monaco);
  }, []);

  function handleEditorDidMount(
    editor: editor.IStandaloneCodeEditor,
    monaco: Monaco
  ) {
    console.debug(`EditorDidMount: (name: ${name})`);
    editorRef.current = editor;
    monacoRef.current = monaco;

    // Register editor in the refs store
    registerEditor(name, editor, monaco);
    setActiveEditor(name);

    // Ensure the model's language is set to JSON for schema validation
    const model = editor.getModel();
    if (model) {
      monaco.editor.setModelLanguage(model, 'json');
      console.debug('Model language set to JSON for:', model.uri.toString());
    }

    // Add context menu action for AI assistant
    editor.addAction({
      id: 'send-to-ai-assistant',
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
                documentName: name,
                selection,
                snippet,
              },
            })
          );
        }
      },
    });

    // Set up keyboard shortcuts
    // Cmd+K => send selection to AI assistant
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, () => {
      const selection = getSelectionContext(editor, monaco);
      if (selection) {
        const snippet = createContextSnippet(selection);
        window.dispatchEvent(
          new CustomEvent('monaco-selection-to-ai', {
            detail: {
              documentName: name,
              selection,
              snippet,
            },
          })
        );
      }
    });

    // Cmd+S => save command
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      const currentValue = editor.getValue();
      if (currentValue) saveDocument(name, currentValue);
    });

    // Cmd+W => close command
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyW, () => {
      const currentValue = editor.getValue();
      if (currentValue) saveDocument(name, currentValue);
      closeDocument(name);
    });

    // Format document shortcut (Shift+Alt+F)
    editor.addCommand(
      monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF,
      () => {
        editor.getAction('editor.action.formatDocument')?.run();
      }
    );

    // Initial validation will be handled by Monaco's onValidate
  }

  function handleEditorValidation(markers: editor.IMarker[]) {
    // Convert Monaco's native JSON validation markers to our error format
    console.debug('Monaco validation markers:', markers);

    const errors: JsonEditorError[] = markers.map((marker) => ({
      path: '', // Monaco doesn't provide JSON path, but we don't need it for display
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
        marker.severity === monacoRef.current?.MarkerSeverity.Error
          ? 'error'
          : marker.severity === monacoRef.current?.MarkerSeverity.Warning
            ? 'warning'
            : 'info',
    }));

    setValidationErrors(errors);

    // Decorations are now handled by Monaco's native validation
    decorationIdsRef.current = [];

    // Show validation panel if there are errors
    if (errors.length > 0 && !showValidationPanel) {
      setShowValidationPanel(true);
      setIsValidationPanelMinimized(false);
    }
  }

  // Cancel debounced saveDocument on unmount and unregister editor
  useEffect(() => {
    const debouncedSaveDocument = debouncedSaveDocumentRef?.current;
    return () => {
      debouncedSaveDocument?.cancel();
      // Decorations cleanup handled by Monaco
      unregisterEditor(name);
      console.debug(`EditorWillUnMount: (name: ${name})`);
    };
  }, [name, unregisterEditor]);

  // Handle error click - navigate to error in editor
  const handleErrorClick = useCallback((error: JsonEditorError) => {
    if (editorRef.current && error.startLineNumber && error.startColumn) {
      // Navigate to error position
      editorRef.current.setPosition({
        lineNumber: error.startLineNumber,
        column: error.startColumn,
      });
      editorRef.current.revealLineInCenter(error.startLineNumber);
      editorRef.current.focus();
    }
  }, []);

  return (
    <div className="relative h-full">
      {pendingDiff ? (
        <>
          <div className="flex items-center justify-between px-2 py-1 border-b bg-muted/40 text-xs">
            <div>
              Review changes for <span className="font-medium">{name}</span>
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => clearPendingDiff(name)}
              >
                Discard
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  saveDocument(name, pendingDiff.modified);
                  clearPendingDiff(name, true);
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
            theme={`vs-${resolvedTheme}`}
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
        <Editor
          height="100%"
          defaultLanguage="json"
          theme={`vs-${resolvedTheme}`}
          defaultPath={
            name.endsWith('.json') ? name : `${name}.json`
          }
          value={value ?? defaultValue}
          beforeMount={handleEditorWillMount}
          onMount={handleEditorDidMount}
          onValidate={handleEditorValidation}
          onChange={(value) => {
            if (value) {
              bumpEditSequence();
              debouncedSaveDocumentRef.current(name, value);
            }
          }}
          options={{
            minimap: { enabled: true },
            scrollBeyondLastLine: true,
            wordWrap: 'on',
            automaticLayout: true,
            formatOnPaste: true,
            formatOnType: true,
            tabSize: 2,
            insertSpaces: true,
            detectIndentation: false,
            folding: true,
            foldingStrategy: 'indentation',
            showFoldingControls: 'always',
            bracketPairColorization: { enabled: true },
            guides: {
              bracketPairs: true,
              indentation: true,
            },
            // Enhanced suggest options for better autocomplete
            suggest: {
              showProperties: true,
              showMethods: true,
              showFunctions: true,
              showConstructors: true,
              showDeprecated: true,
              showFields: true,
              showVariables: true,
              showClasses: true,
              showStructs: true,
              showInterfaces: true,
              showModules: true,
              showTypeParameters: true,
              showValues: true,
              showConstants: true,
              showEnums: true,
              showEnumMembers: true,
              showKeywords: true,
              showWords: false,
              showColors: true,
              showFiles: false,
              showReferences: true,
              showFolders: false,
              showOperators: true,
              showUnits: true,
              showSnippets: true,
              snippetsPreventQuickSuggestions: false,
              insertMode: 'insert', // Changed from 'replace' to 'insert' for better UX
              filterGraceful: true, // Allow fuzzy matching
              localityBonus: true, // Prioritize nearby suggestions
              shareSuggestSelections: true, // Share suggestions across files
              showIcons: true, // Show icons in suggestions
            },
            // Quick suggestions appear faster
            quickSuggestions: {
              strings: true,
              comments: false,
              other: true,
            },
            quickSuggestionsDelay: 10, // Faster suggestions
            suggestSelection: 'first',
            suggestOnTriggerCharacters: true,
            acceptSuggestionOnEnter: 'on',
            acceptSuggestionOnCommitCharacter: true,
            wordBasedSuggestions: 'off', // Disable word-based to rely on schema
            // IntelliSense features
            parameterHints: {
              enabled: true,
              cycle: true,
            },
            hover: {
              enabled: true,
              delay: 300,
              sticky: true,
            },
            // Better completion behavior
            tabCompletion: 'on',
            snippetSuggestions: 'inline',
            inlineSuggest: {
              enabled: true,
            },
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

      {/* Enhanced Validation Panel */}
      {showValidationPanel && validationErrors.length > 0 && (
        <ValidationPanel
          errors={validationErrors}
          isMinimized={isValidationPanelMinimized}
          onToggleMinimize={() =>
            setIsValidationPanelMinimized(!isValidationPanelMinimized)
          }
          onErrorClick={handleErrorClick}
          onClose={() => setShowValidationPanel(false)}
          className="z-40"
        />
      )}
    </div>
  );
}

export const EditorMonacoJsonMemoized = React.memo(
  EditorMonacoJson,
  (prev, next) => {
    return (
      prev.name === next.name &&
      prev.value === next.value &&
      prev.saveDocumentDebounceWait === next.saveDocumentDebounceWait
    );
  }
);
