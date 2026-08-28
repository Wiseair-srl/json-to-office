import { useCallback } from 'react';
import { applyQualityFixes, canApplyFixes } from '../lib/quality-fixes';
import type { QualityFinding } from '../lib/quality-findings';
import { useDocumentsStore } from '../store/documents-store-provider';
import { useEditorRefsStore } from '../store/editor-refs-store';

export interface ApplyQualityFixOutcome {
  ok: boolean;
  error?: string;
}

/**
 * Apply a finding's suggested fixes to the document it was computed against.
 *
 * The patch deliberately goes through the documents store rather than
 * `editor.executeEdits`: Monaco collapses long strings into `§jtoc:<id>§`
 * sentinels, so the model text is NOT the document. An RFC 6902 patch computed
 * against the real JSON and written into the model would land on a sentinel and
 * silently destroy whatever value it stood for. Writing the document text back
 * to the store is the established route (see `useMutateActiveDocumentAtPath` in
 * font-picker-dialog.tsx) and lets the editor re-expand the text on its own.
 */
export function useApplyQualityFix(): (
  finding: QualityFinding,
  expectedDocumentName: string | undefined
) => ApplyQualityFixOutcome {
  const activeTab = useDocumentsStore((s) => s.activeTab);
  const documents = useDocumentsStore((s) => s.documents);
  const documentTypes = useDocumentsStore((s) => s.documentTypes);
  const saveDocument = useDocumentsStore((s) => s.saveDocument);

  return useCallback(
    (
      finding: QualityFinding,
      expectedDocumentName: string | undefined
    ): ApplyQualityFixOutcome => {
      const fixes = finding.fixes;
      // `canApplyFixes` already rejects an empty list and an unresolvable
      // move/copy, so it is the whole guard rather than one of two.
      if (!fixes || !canApplyFixes(fixes)) {
        return { ok: false, error: 'This finding carries no applicable fix.' };
      }
      if (!activeTab) return { ok: false, error: 'No active file' };

      // A tab switch leaves the panel showing the previous document's findings
      // until a new analysis lands. Patching whatever happens to be active
      // would write this finding's pointers into a file no finding described —
      // silently, because `applyQualityFixes` only checks that a path resolves,
      // never that it is the path the defect was found at.
      if (expectedDocumentName && expectedDocumentName !== activeTab) {
        return {
          ok: false,
          error: `This finding belongs to ${expectedDocumentName}, which is no longer the active file.`,
        };
      }
      if (documentTypes[activeTab] === 'application/json+theme') {
        return {
          ok: false,
          error: 'Quality fixes apply to a document, not to a theme.',
        };
      }

      const doc = documents.find((d) => d.name === activeTab);
      if (!doc) return { ok: false, error: 'Active document not found' };

      // Monaco saves on a 300ms debounce, so the store text can be one burst of
      // typing out of date. Patching that and writing it back would both drop
      // the keystrokes in flight and lose the patch, because the trailing save
      // fires afterwards with its own pre-patch text. Flushing first collapses
      // both races: the store becomes current, and the pending timer has
      // nothing left to deliver.
      const editorRef = useEditorRefsStore.getState().getEditor(activeTab);
      editorRef?.flushPendingSave?.();
      // Read the live model rather than the store snapshot this callback closed
      // over: the flush above has just made them agree, but the snapshot is the
      // one captured at render time.
      const sourceText = editorRef
        ? editorRef.toStorageValue(editorRef.editor.getValue())
        : doc.text;

      let parsed: unknown;
      try {
        parsed = JSON.parse(sourceText);
      } catch (err) {
        return {
          ok: false,
          error: `Active document is not valid JSON: ${(err as Error).message}`,
        };
      }

      const result = applyQualityFixes(parsed, fixes);
      if (!result.ok) return { ok: false, error: result.error };

      saveDocument(activeTab, JSON.stringify(result.doc, null, 2));
      return { ok: true };
    },
    [activeTab, documentTypes, documents, saveDocument]
  );
}
