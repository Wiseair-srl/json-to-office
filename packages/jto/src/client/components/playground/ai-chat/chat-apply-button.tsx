import { Check, Copy } from 'lucide-react';
import { useState, useCallback, useMemo } from 'react';
import { Button } from '../../ui/button';
import { useDocumentsStore } from '../../../store/documents-store-provider';
import { mergeAiOutput, applyId as stableId } from '../../../lib/apply-merge';
import type { SelectionContext } from '../../../lib/monaco-selection-utils';

interface ChatApplyButtonProps {
  json: string;
  context?: (SelectionContext & { documentName?: string })[];
}

export function ChatApplyButton({ json, context }: ChatApplyButtonProps) {
  const [copied, setCopied] = useState(false);
  const applyId = useMemo(() => stableId(json), [json]);
  const activeTab = useDocumentsStore((s) => s.activeTab);
  const documents = useDocumentsStore((s) => s.documents);
  const applied = useDocumentsStore((s) => (s.acceptedApplyIds || []).includes(applyId));
  const setPendingDiff = useDocumentsStore((s) => s.setPendingDiff);
  const createDocument = useDocumentsStore((s) => s.createDocument);
  const openDocument = useDocumentsStore((s) => s.openDocument);

  const handleApply = useCallback(() => {
    let formatted: string;
    try {
      formatted = JSON.stringify(JSON.parse(json), null, 2);
    } catch {
      formatted = json;
    }

    if (activeTab) {
      const doc = documents.find((d) => d.name === activeTab);
      const original = doc?.text || '';
      const ctx = context?.[0];
      const { original: orig, modified } = mergeAiOutput(original, formatted, ctx);
      setPendingDiff(activeTab, orig, modified, applyId);
    } else {
      const name = `ai-generated-${Date.now()}`;
      createDocument(name, formatted);
      openDocument(name);
    }
  }, [json, activeTab, documents, setPendingDiff, createDocument, openDocument, context, applyId]);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(json);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [json]);

  return (
    <div className="flex gap-1.5 px-3 py-2 border-t">
      <Button variant="secondary" size="sm" onClick={handleApply} disabled={applied}>
        {applied ? 'Applied' : 'Apply to Editor'}
      </Button>
      <Button variant="ghost" size="sm" onClick={handleCopy}>
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );
}
