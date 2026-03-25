import { Check, Copy } from 'lucide-react';
import { useState, useCallback, useMemo } from 'react';
import { jsonrepair } from 'jsonrepair';
import { Button } from '../../ui/button';
import { useDocumentsStore } from '../../../store/documents-store-provider';
import { mergeAiOutput, applyId as stableId, mergeTemplatesDelta } from '../../../lib/apply-merge';
import type { SelectionContext } from '../../../lib/monaco-selection-utils';
import type { AiScope } from '../../../store/chat-store';

interface ChatApplyButtonProps {
  json: string;
  context?: (SelectionContext & { documentName?: string })[];
  scope?: AiScope;
}

export function ChatApplyButton({ json: rawJson, context, scope }: ChatApplyButtonProps) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const json = useMemo(() => {
    try { JSON.parse(rawJson); return rawJson; } catch { /* needs repair */ }
    try { return jsonrepair(rawJson); } catch { /* try wrapping */ }
    // Bare property like "key": { ... } — wrap in braces
    const wrapped = `{${rawJson}}`;
    try { JSON.parse(wrapped); return wrapped; } catch { /* needs repair */ }
    try { return jsonrepair(wrapped); } catch { return null; }
  }, [rawJson]);

  const applyId = useMemo(() => stableId(json || rawJson), [json, rawJson]);
  const activeTab = useDocumentsStore((s) => s.activeTab);
  const documents = useDocumentsStore((s) => s.documents);
  const applied = useDocumentsStore((s) => (s.acceptedApplyIds || []).includes(applyId));
  const setPendingDiff = useDocumentsStore((s) => s.setPendingDiff);
  const createDocument = useDocumentsStore((s) => s.createDocument);
  const openDocument = useDocumentsStore((s) => s.openDocument);

  const handleApply = useCallback(() => {
    if (!json) return;
    setError(null);
    try {
      if (activeTab) {
        const doc = documents.find((d) => d.name === activeTab);
        const original = doc?.text || '';

        // Scope-aware merge for templates delta
        if (scope === 'templates') {
          try {
            const currentDoc = JSON.parse(original);
            const fragment = JSON.parse(json);
            if (Array.isArray(fragment.templates)) {
              if (!currentDoc.props) currentDoc.props = {};
              currentDoc.props.templates = mergeTemplatesDelta(
                currentDoc.props.templates || [],
                fragment.templates,
              );
              const modified = JSON.stringify(currentDoc, null, 2);
              setPendingDiff(activeTab, original, modified, applyId);
              return;
            }
          } catch { /* fall through to generic merge */ }
        }

        const ctx = context?.[0];
        const { original: orig, modified } = mergeAiOutput(original, json, ctx);
        setPendingDiff(activeTab, orig, modified, applyId);
      } else {
        const name = `ai-generated-${Date.now()}`;
        createDocument(name, json);
        openDocument(name);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Merge failed');
    }
  }, [json, activeTab, documents, setPendingDiff, createDocument, openDocument, context, scope, applyId]);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(rawJson);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [rawJson]);

  return (
    <div className="flex flex-col gap-1 px-3 py-2 border-t">
      <div className="flex gap-1.5">
        <Button variant="secondary" size="sm" onClick={handleApply} disabled={applied || !json}>
          {applied ? 'Applied' : !json ? 'Invalid JSON' : 'Apply to Editor'}
        </Button>
        <Button variant="ghost" size="sm" onClick={handleCopy}>
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
      </div>
      {error && <p className="text-xs text-destructive m-0">{error}</p>}
    </div>
  );
}
