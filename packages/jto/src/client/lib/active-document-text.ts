import { useEditorRefsStore } from '../store/editor-refs-store';

/**
 * The active document's text, with Monaco's save debounce collapsed first.
 *
 * `EditorMonacoJson` saves on a 300ms debounce, so the store snapshot a
 * callback closed over can be a burst of typing out of date. Writing a
 * mutation on top of that snapshot loses those keystrokes, and the trailing
 * save then fires holding its own pre-mutation text and silently reverts the
 * mutation as well — the editor ref states exactly this contract on
 * `flushPendingSave`, and it has to be honoured by every writer.
 *
 * Flushing first collapses both races: the store becomes current, and the
 * pending timer has nothing left to deliver. The live model is then the
 * authority, because `storedText` is still the render-time snapshot.
 */
export function currentDocumentText(
  documentName: string,
  storedText: string
): string {
  const editorRef = useEditorRefsStore.getState().getEditor(documentName);
  editorRef?.flushPendingSave?.();
  return editorRef
    ? editorRef.toStorageValue(editorRef.editor.getValue())
    : storedText;
}
