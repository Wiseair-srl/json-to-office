import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useTheme } from '../theme-provider';
import Editor, { Monaco, DiffEditor } from '@monaco-editor/react';
import debounce from 'lodash.debounce';
import type { editor } from 'monaco-editor';
import { useDocumentsStore } from '../../store/documents-store-provider';
import { useOutputStore } from '../../store/output-store-provider';
import { Button } from '../ui/button';
import { type JsonEditorError } from '../../lib/json-types';
// configureMonacoInstance is called at startup (main.tsx) and by useMonacoPlugins
import { useEditorRefsStore } from '../../store/editor-refs-store';
import {
  getSelectionContext,
  createContextSnippet,
} from '../../lib/monaco-selection-utils';
import {
  installLongStringCollapser,
  type CollapseController,
} from '../../lib/monaco-collapse-strings';
import { ValidationPanel, ValidationStatusBar } from './validation-panel';
import { monacoThemeFor, registerMonacoThemes } from '../../lib/monaco-theme';
import { FORMAT } from '../../lib/env';
import { updateMonacoDocumentBlocks } from '../../lib/monaco-config';
import { readDocumentBlockDefinitions } from '../../lib/document-blocks';

/**
 * Ensure defaultPath matches the document schema's fileMatch (*.FORMAT.json).
 *
 * Documents are discovered with their extension stripped, so `name` is
 * `contract-v2`, not `contract-v2.docx.json`. A model URI of `contract-v2.json`
 * matches no registered schema, leaving Monaco's JSON worker on its
 * schema-less path: no validation, no hovers, and "completions" that are just
 * values already present in the file. Mirrors resolveThemeDefaultPath.
 */
function resolveDocumentDefaultPath(name: string): string {
  const ext = `.${FORMAT}.json`;
  if (name.endsWith(ext)) return name;
  const base = name
    .replace(/\.\w+\.theme\.json$/, '')
    .replace(/\.\w+\.json$/, '')
    .replace(/\.json$/, '');
  return base + ext;
}

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
  const setOutput = useOutputStore((state) => state.setOutput);
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
  const collapseRef = useRef<CollapseController | null>(null);
  // The full text we last wrote to the store. When the controlled `value` prop
  // echoes this back, we must NOT let Monaco replace the (collapsed) model with
  // it — that would expand every chip and jump the cursor on each save.
  const lastSavedRef = useRef<string | null>(null);
  // The value actually handed to <Editor>: updated only on genuine external
  // changes (document switch, AI apply), never on our own save echoes.
  const [editorValue, setEditorValue] = useState<string | undefined>(
    value ?? defaultValue
  );
  const { registerEditor, unregisterEditor, setActiveEditor } =
    useEditorRefsStore();

  const debouncedSaveDocumentRef = useRef(
    debounce(saveDocument, saveDocumentDebounceWait)
  );

  // Collapse newly-pasted long strings after typing settles (skips the string
  // under the cursor so it never yanks text mid-edit). Re-anchor existing
  // chips first: undo of an outline reorder moves sentinel text without
  // moving its decoration.
  const debouncedCollapseNewRef = useRef(
    debounce(() => {
      const editorInstance = editorRef.current;
      const controller = collapseRef.current;
      if (!editorInstance || !controller) return;
      controller.resyncDecorations();
      const position = editorInstance.getPosition();
      const model = editorInstance.getModel();
      const cursorOffset =
        position && model ? model.getOffsetAt(position) : undefined;
      controller.collapseNew(cursorOffset);
    }, 600)
  );

  // The document's block definitions are part of the schema Monaco validates
  // against (`ref` completes them, their slots complete and validate), so
  // they are read from the model text and handed over whenever they may have
  // changed: on mount, on focus (a tab switch), and after typing settles.
  // The read is tolerant of a document mid-edit; the handover is a no-op
  // when the definitions did not change, which is every keystroke outside
  // `props.blocks`.
  const debouncedSyncBlocksRef = useRef(
    debounce((monaco: Monaco, modelText: string) => {
      // Expanded first: a long description or default sits in the model as
      // a collapse sentinel, and the schema must carry the real value.
      updateMonacoDocumentBlocks(
        monaco,
        readDocumentBlockDefinitions(
          collapseRef.current
            ? collapseRef.current.toStorageValue(modelText)
            : modelText
        )
      );
    }, 400)
  );
  // The document changed under the editor, or became the one being edited:
  // hand its definitions over now rather than after the typing debounce.
  const syncBlocksNow = useCallback((monaco: Monaco, modelText: string) => {
    debouncedSyncBlocksRef.current(monaco, modelText);
    debouncedSyncBlocksRef.current.flush();
  }, []);

  // Setup Monaco editor for JSON with schema validation
  // Note: schema configuration is handled by configureMonaco() at startup
  // and updateMonacoWithPlugins() via useMonacoPlugins hook.
  // Calling configureMonacoInstance here would overwrite plugin-aware schemas.
  const handleEditorWillMount = useCallback((monaco: Monaco) => {
    // Idempotent; guards the case where an editor mounts before the global
    // configureMonaco() promise has resolved.
    registerMonacoThemes(monaco);
    console.debug('Setting up Monaco for JSON editor');
  }, []);

  // Commit a queued save immediately. lodash's `flush` is a no-op when nothing
  // is pending, so callers can flush unconditionally before writing.
  const flushPendingSave = useCallback(() => {
    debouncedSaveDocumentRef.current.flush();
  }, []);

  // Reconstruct the full document (collapsed sentinels → original values) before persisting.
  const toStorageValue = useCallback(
    (modelText: string) =>
      collapseRef.current
        ? collapseRef.current.toStorageValue(modelText)
        : modelText,
    []
  );

  function handleEditorDidMount(
    editor: editor.IStandaloneCodeEditor,
    monaco: Monaco
  ) {
    console.debug(`EditorDidMount: (name: ${name})`);
    editorRef.current = editor;
    monacoRef.current = monaco;

    // Ensure the model's language is set to JSON for schema validation
    const model = editor.getModel();
    if (model) {
      monaco.editor.setModelLanguage(model, 'json');
      console.debug('Model language set to JSON for:', model.uri.toString());
    }

    // Collapse very long string values (base64, big blobs, …) into clickable chips
    collapseRef.current = installLongStringCollapser(editor, monaco);
    collapseRef.current.recollapse();

    // This document's blocks, now and whenever this editor becomes the one
    // being edited.
    syncBlocksNow(monaco, editor.getValue());
    editor.onDidFocusEditorText(() => syncBlocksNow(monaco, editor.getValue()));

    // Register editor in the refs store. Pass the sentinel reconstructor so any
    // consumer reading live text (preview/build) expands collapsed strings, and
    // the collapse controller so outline reorders can re-anchor chips.
    registerEditor(
      name,
      editor,
      monaco,
      toStorageValue,
      collapseRef.current,
      flushPendingSave
    );
    setActiveEditor(name);

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
      const currentValue = toStorageValue(editor.getValue());
      if (currentValue) {
        lastSavedRef.current = currentValue;
        saveDocument(name, currentValue);
      }
    });

    // Cmd+W => close command
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyW, () => {
      const currentValue = toStorageValue(editor.getValue());
      if (currentValue) {
        lastSavedRef.current = currentValue;
        saveDocument(name, currentValue);
      }
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

    // Drop markers that fall inside a collapsed sentinel — the user is seeing a
    // chip, not the real value, so a complaint about it would be confusing.
    const visibleMarkers = collapseRef.current
      ? markers.filter(
          (marker) =>
            !collapseRef.current!.isRangeCollapsed({
              startLineNumber: marker.startLineNumber,
              startColumn: marker.startColumn,
              endLineNumber: marker.endLineNumber,
              endColumn: marker.endColumn,
            })
        )
      : markers;

    const errors: JsonEditorError[] = visibleMarkers.map((marker) => ({
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
    setOutput({
      hasValidationErrors: errors.some((e) => e.severity === 'error'),
    });

    // Decorations are now handled by Monaco's native validation
    decorationIdsRef.current = [];

    // Show validation panel if there are errors
    if (errors.length > 0 && !showValidationPanel) {
      setShowValidationPanel(true);
      setIsValidationPanelMinimized(false);
    }
  }

  // Flush debounced saveDocument on unmount and unregister editor
  useEffect(() => {
    const debouncedSaveDocument = debouncedSaveDocumentRef?.current;
    const debouncedCollapseNew = debouncedCollapseNewRef?.current;
    const debouncedSyncBlocks = debouncedSyncBlocksRef?.current;
    return () => {
      debouncedSaveDocument?.flush();
      debouncedCollapseNew?.cancel();
      debouncedSyncBlocks?.cancel();
      collapseRef.current?.dispose();
      collapseRef.current = null;
      // Decorations cleanup handled by Monaco
      unregisterEditor(name);
      console.debug(`EditorWillUnMount: (name: ${name})`);
    };
  }, [name, unregisterEditor]);

  // Detect genuine external content changes. Our own save echoes (value ===
  // lastSaved) are ignored, so Monaco never sees a value change for them and
  // leaves the collapsed model untouched.
  useEffect(() => {
    if (value === undefined) return;
    if (value === lastSavedRef.current) return;
    // A queued collapse pass holds offsets into the model we are about to
    // replace, so drop it; the recollapse below rebuilds that state anyway.
    debouncedCollapseNewRef.current.cancel();
    // Replace the model ourselves rather than letting the react wrapper diff
    // its `value` prop against the model. The two are not comparable once the
    // collapser has run — the model holds sentinels where long strings used to
    // be, so it is both shorter than and textually unlike the document. The
    // wrapper's edit is computed from that mismatch and can leave the previous
    // document's tail stranded past the end of the new one, which surfaces as
    // a bogus "End of file expected" error on a perfectly valid document.
    const model = editorRef.current?.getModel();
    if (model && model.getValue() !== value) model.setValue(value);
    setEditorValue(value);
    if (monacoRef.current) syncBlocksNow(monacoRef.current, value);
  }, [value, syncBlocksNow]);

  // When an external change actually lands, Monaco replaces the model — re-run
  // the collapse pass on the new text. Skip the first run: the initial collapse
  // happens in handleEditorDidMount.
  const didMountValueEffectRef = useRef(false);
  useEffect(() => {
    if (!didMountValueEffectRef.current) {
      didMountValueEffectRef.current = true;
      return;
    }
    if (!collapseRef.current) return;
    const handle = setTimeout(() => {
      // Same reasoning as above: the replacement itself queues a collapse pass
      // anchored to pre-replacement offsets. recollapse() resets state and
      // re-scans, so that queued pass is both redundant and unsafe.
      debouncedCollapseNewRef.current.cancel();
      collapseRef.current?.recollapse();
    }, 0);
    return () => clearTimeout(handle);
  }, [editorValue]);

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
            theme={monacoThemeFor(resolvedTheme)}
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
          theme={monacoThemeFor(resolvedTheme)}
          defaultPath={resolveDocumentDefaultPath(name)}
          value={editorValue}
          beforeMount={handleEditorWillMount}
          onMount={handleEditorDidMount}
          onValidate={handleEditorValidation}
          onChange={(value) => {
            // Ignore our own collapse/expand edits — they don't change the
            // real document and saving the sentinel would lose data.
            if (collapseRef.current?.isApplyingEdits()) return;
            if (value) {
              bumpEditSequence();
              const storage = toStorageValue(value);
              lastSavedRef.current = storage;
              debouncedSaveDocumentRef.current(name, storage);
              debouncedCollapseNewRef.current();
              if (monacoRef.current)
                debouncedSyncBlocksRef.current(monacoRef.current, value);
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
