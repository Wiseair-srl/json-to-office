import { describe, it, expect, beforeEach } from 'vitest';
import type { editor as MonacoEditorType } from 'monaco-editor';
import type { Monaco } from '@monaco-editor/react';
import { useEditorRefsStore } from '../../store/editor-refs-store';
import { currentDocumentText } from '../active-document-text';

/**
 * The bug this guards: the font dialog read `doc.text` — the render-time store
 * snapshot — and wrote a mutation back without flushing. Monaco's trailing save
 * then fired holding its own pre-mutation text, so the font change vanished and
 * the keystrokes in flight went with it.
 */
function registerEditor(
  name: string,
  liveText: string,
  onFlush: () => void
): void {
  const editor = {
    getValue: () => liveText,
  } as unknown as MonacoEditorType.IStandaloneCodeEditor;
  useEditorRefsStore
    .getState()
    .registerEditor(
      name,
      editor,
      {} as Monaco,
      (text) => `${text}/expanded`,
      undefined,
      onFlush
    );
}

describe('currentDocumentText', () => {
  beforeEach(() => {
    useEditorRefsStore.setState({ editors: new Map(), activeEditorName: null });
  });

  it('flushes the pending save before reading', () => {
    let flushed = 0;
    registerEditor('doc.docx.json', 'live', () => (flushed += 1));

    currentDocumentText('doc.docx.json', 'stale');

    expect(flushed).toBe(1);
  });

  it('prefers the live model over the store snapshot', () => {
    registerEditor('doc.docx.json', 'live', () => {});

    // Through `toStorageValue`, so collapsed long-string sentinels expand
    // rather than leaking into the document.
    expect(currentDocumentText('doc.docx.json', 'stale')).toBe('live/expanded');
  });

  it('falls back to the stored text when no editor is mounted', () => {
    expect(currentDocumentText('doc.docx.json', 'stored')).toBe('stored');
  });

  it('ignores an editor registered for a different document', () => {
    registerEditor('other.docx.json', 'other-live', () => {});

    expect(currentDocumentText('doc.docx.json', 'stored')).toBe('stored');
  });
});
