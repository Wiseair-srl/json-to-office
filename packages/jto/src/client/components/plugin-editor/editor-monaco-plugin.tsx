import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Editor, { type Monaco } from '@monaco-editor/react';
import type { editor as MonacoEditorType } from 'monaco-editor';
import debounce from 'lodash.debounce';
import { useTheme } from '../theme-provider';
import { monacoThemeFor, registerMonacoThemes } from '../../lib/monaco-theme';
import { useDocumentsStore } from '../../store/documents-store-provider';
import { useEditorRefsStore } from '../../store/editor-refs-store';
import { useBrowserPluginsStore } from '../../store/browser-plugins-store';
import { pluginModelPath } from '../../lib/plugins/compiler';
import { ensurePluginTypeScript } from '../../lib/plugins/type-libs';
import type { JsonEditorError } from '../../lib/json-types';
import {
  ValidationPanel,
  ValidationStatusBar,
} from '../json-editor/validation-panel';
import { PluginEditorStripMemoized } from './plugin-editor-strip';

/**
 * A plugin file open in a tab: Monaco in TypeScript mode over the same model
 * the compiler uses, so completions, hovers and the diagnostics below come
 * from one program. Saving is the document store's job, debounced like the
 * JSON editors; compiling is the sync hook's, which watches the store.
 */
function EditorMonacoPlugin({
  name,
  value,
  saveDocumentDebounceWait,
}: {
  name: string;
  value: string;
  saveDocumentDebounceWait: number;
}) {
  const editorRef = useRef<MonacoEditorType.IStandaloneCodeEditor | null>(null);
  const { resolvedTheme } = useTheme();
  const saveDocument = useDocumentsStore((s) => s.saveDocument);
  const closeDocument = useDocumentsStore((s) => s.closeDocument);
  const { registerEditor, unregisterEditor, setActiveEditor } =
    useEditorRefsStore();
  const diagnostics = useBrowserPluginsStore(
    (s) => s.records[name]?.diagnostics
  );

  // Our own save echoes must not be written back into the editor: with the
  // debounce the store trails the model, and the wrapper would otherwise
  // replace newer keystrokes with the older saved text.
  const lastSavedRef = useRef<string | null>(null);
  const [editorValue, setEditorValue] = useState(value);
  const debouncedSaveRef = useRef(
    debounce((text: string) => {
      lastSavedRef.current = text;
      saveDocument(name, text);
    }, saveDocumentDebounceWait)
  );

  const [showPanel, setShowPanel] = useState(true);
  const [panelMinimized, setPanelMinimized] = useState(false);
  const userDismissedRef = useRef(false);

  const errors = useMemo<JsonEditorError[]>(
    () =>
      (diagnostics ?? []).map((d) => ({
        path: d.source === 'typescript' ? '' : d.source,
        message: d.message,
        code: d.source,
        severity: d.severity,
        ...(d.line !== undefined
          ? {
              startLineNumber: d.line,
              startColumn: d.column,
              endLineNumber: d.endLine,
              endColumn: d.endColumn,
            }
          : {}),
      })),
    [diagnostics]
  );

  useEffect(() => {
    if (errors.length > 0 && !userDismissedRef.current) {
      setShowPanel(true);
      setPanelMinimized(false);
    }
    if (errors.length === 0) userDismissedRef.current = false;
  }, [errors.length]);

  const handleWillMount = useCallback((monaco: Monaco) => {
    registerMonacoThemes(monaco);
    // Types load asynchronously; diagnostics settle once they have.
    void ensurePluginTypeScript(monaco);
  }, []);

  const flushPendingSave = useCallback(() => {
    debouncedSaveRef.current.flush();
  }, []);

  const handleMount = useCallback(
    (editor: MonacoEditorType.IStandaloneCodeEditor, monaco: Monaco) => {
      editorRef.current = editor;
      registerEditor(
        name,
        editor,
        monaco,
        undefined,
        undefined,
        flushPendingSave
      );
      setActiveEditor(name);

      const saveNow = () => {
        const text = editor.getValue();
        debouncedSaveRef.current.cancel();
        lastSavedRef.current = text;
        saveDocument(name, text);
      };
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, saveNow);
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyW, () => {
        saveNow();
        closeDocument(name);
      });
      editor.addCommand(
        monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF,
        () => {
          editor.getAction('editor.action.formatDocument')?.run();
        }
      );
    },
    [
      closeDocument,
      flushPendingSave,
      name,
      registerEditor,
      saveDocument,
      setActiveEditor,
    ]
  );

  useEffect(() => {
    const debouncedSave = debouncedSaveRef.current;
    return () => {
      debouncedSave.flush();
      unregisterEditor(name);
    };
  }, [name, unregisterEditor]);

  // A genuine external change (rename, AI apply, another view): replace the
  // model text. Our own echoes are recognised by `lastSavedRef`.
  useEffect(() => {
    if (value === lastSavedRef.current) return;
    const model = editorRef.current?.getModel();
    if (model && model.getValue() !== value) model.setValue(value);
    setEditorValue(value);
  }, [value]);

  const handleErrorClick = useCallback((error: JsonEditorError) => {
    const editor = editorRef.current;
    if (!editor || !error.startLineNumber) return;
    editor.setPosition({
      lineNumber: error.startLineNumber,
      column: error.startColumn ?? 1,
    });
    editor.revealLineInCenter(error.startLineNumber);
    editor.focus();
  }, []);

  return (
    <div className="flex h-full flex-col">
      <PluginEditorStripMemoized docName={name} text={value} />
      <div className="relative min-h-0 flex-1">
        <Editor
          height="100%"
          defaultLanguage="typescript"
          path={pluginModelPath(name)}
          value={editorValue}
          theme={monacoThemeFor(resolvedTheme)}
          beforeMount={handleWillMount}
          onMount={handleMount}
          keepCurrentModel
          onChange={(text) => {
            if (text !== undefined) debouncedSaveRef.current(text);
          }}
          options={{
            lineNumbers: 'on',
            glyphMargin: true,
            folding: true,
            lineDecorationsWidth: 5,
            lineNumbersMinChars: 3,
            renderValidationDecorations: 'on',
            quickSuggestions: { other: true, comments: false, strings: true },
            acceptSuggestionOnCommitCharacter: true,
            acceptSuggestionOnEnter: 'on',
            autoIndent: 'advanced',
            formatOnType: true,
            formatOnPaste: true,
            automaticLayout: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: true,
            tabSize: 2,
            wordWrap: 'off',
          }}
        />
        <div className="absolute top-0 right-0">
          <ValidationStatusBar
            errors={errors}
            onClick={() => {
              setShowPanel(true);
              setPanelMinimized(false);
            }}
          />
        </div>
        {showPanel && errors.length > 0 && (
          <ValidationPanel
            errors={errors}
            isMinimized={panelMinimized}
            onToggleMinimize={() => setPanelMinimized((v) => !v)}
            onErrorClick={handleErrorClick}
            onClose={() => {
              setShowPanel(false);
              userDismissedRef.current = true;
            }}
            className="z-40"
          />
        )}
      </div>
    </div>
  );
}

export const EditorMonacoPluginMemoized = React.memo(EditorMonacoPlugin);
