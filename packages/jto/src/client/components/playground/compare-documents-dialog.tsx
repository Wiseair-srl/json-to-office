import React, { useEffect, useMemo, useState } from 'react';
import { GitCompareArrows, FileDiff } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Badge } from '../ui/badge';
import { Spinner } from '../ui/spinner';
import { useToast } from '../ui/use-toast';
import { useDocumentsStore } from '../../store/documents-store-provider';
import { useShallow } from 'zustand/react/shallow';
import { API_ENDPOINTS } from '../../config/api';

interface DiffSummary {
  tracked: { modified: number; inserted: number; deleted: number };
  untracked: {
    path: string;
    kind: string;
    component: string;
    detail: string;
  }[];
  unchangedBlocks: number;
  notes: string[];
}

interface DiffResponse {
  success: boolean;
  data: { document: unknown; summary: DiffSummary };
}

interface CompareDocumentsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Compare two documents into a tracked-change redline: picks base and
 * revised versions from the saved documents, calls /api/docx/diff, and
 * opens the resulting redline as a regular document — so the existing
 * preview and download pipeline applies to it unchanged.
 */
export const CompareDocumentsDialog: React.FC<CompareDocumentsDialogProps> = ({
  open,
  onOpenChange,
}) => {
  const { documents, documentTypes, activeTab, createDocument, openDocument } =
    useDocumentsStore(
      useShallow((state) => ({
        documents: state.documents,
        documentTypes: state.documentTypes,
        activeTab: state.activeTab,
        createDocument: state.createDocument,
        openDocument: state.openDocument,
      }))
    );
  const { toast } = useToast();

  const reportDocuments = useMemo(
    () =>
      documents.filter(
        (doc) => documentTypes[doc.name] !== 'application/json+theme'
      ),
    [documents, documentTypes]
  );

  const [baseName, setBaseName] = useState<string>('');
  const [revisedName, setRevisedName] = useState<string>('');
  const [author, setAuthor] = useState<string>('playground');
  const [isDiffing, setIsDiffing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<DiffSummary | null>(null);
  const [redlineDocument, setRedlineDocument] = useState<unknown>(null);

  // A computed diff is only valid for the inputs it was run with: changing
  // base/revised/author discards it (the footer falls back to Compare).
  const resetResult = () => {
    setError(null);
    setSummary(null);
    setRedlineDocument(null);
  };

  // Sensible defaults each time the dialog opens: revised = active tab,
  // base = the first other document. Deliberately keyed on `open` only —
  // re-running on store changes would clobber the user's selection.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setSummary(null);
    setRedlineDocument(null);
    const names = reportDocuments.map((d) => d.name);
    const revised = names.includes(activeTab) ? activeTab : names[0] ?? '';
    setRevisedName(revised);
    setBaseName(names.find((n) => n !== revised) ?? '');
  }, [open]);

  const runDiff = async () => {
    const base = reportDocuments.find((d) => d.name === baseName);
    const revised = reportDocuments.find((d) => d.name === revisedName);
    if (!base || !revised) return;

    setIsDiffing(true);
    setError(null);
    setSummary(null);
    setRedlineDocument(null);
    try {
      const response = await fetch(API_ENDPOINTS.diff, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          oldDefinition: base.text,
          newDefinition: revised.text,
          options: { author: author || 'playground' },
        }),
      });
      const body = (await response.json()) as DiffResponse & {
        error?: string;
        errors?: { message?: string }[];
      };
      if (!response.ok || !body.success) {
        const details = Array.isArray(body.errors)
          ? `: ${body.errors
              .slice(0, 3)
              .map((e) => e.message || String(e))
              .join('; ')}`
          : '';
        throw new Error(
          (body.error || `Diff failed (${response.status})`) + details
        );
      }
      setSummary(body.data.summary);
      setRedlineDocument(body.data.document);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Diff failed');
    } finally {
      setIsDiffing(false);
    }
  };

  const openRedline = () => {
    if (!redlineDocument) return;
    const existing = new Set(documents.map((d) => d.name));
    let name = `${revisedName}-redline`;
    let counter = 2;
    while (existing.has(name)) {
      name = `${revisedName}-redline-${counter++}`;
    }
    createDocument(name, JSON.stringify(redlineDocument, null, 2));
    openDocument(name);
    toast({ title: `Redline created: ${name}` });
    onOpenChange(false);
  };

  const totalTracked = summary
    ? summary.tracked.modified +
      summary.tracked.inserted +
      summary.tracked.deleted
    : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitCompareArrows className="size-4" />
            Compare documents
          </DialogTitle>
          <DialogDescription>
            Diff two versions into a redline with native Word tracked changes
            (accept/reject in Word).
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="diff-base">Base (old)</Label>
              <Select
                value={baseName}
                onValueChange={(value) => {
                  setBaseName(value);
                  resetResult();
                }}
              >
                <SelectTrigger id="diff-base">
                  <SelectValue placeholder="Select document" />
                </SelectTrigger>
                <SelectContent>
                  {reportDocuments.map((doc) => (
                    <SelectItem key={doc.name} value={doc.name}>
                      {doc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="diff-revised">Revised (new)</Label>
              <Select
                value={revisedName}
                onValueChange={(value) => {
                  setRevisedName(value);
                  resetResult();
                }}
              >
                <SelectTrigger id="diff-revised">
                  <SelectValue placeholder="Select document" />
                </SelectTrigger>
                <SelectContent>
                  {reportDocuments.map((doc) => (
                    <SelectItem key={doc.name} value={doc.name}>
                      {doc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="diff-author">Revision author</Label>
            <Input
              id="diff-author"
              value={author}
              onChange={(e) => {
                setAuthor(e.target.value);
                resetResult();
              }}
              placeholder="playground"
            />
          </div>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          {summary && (
            <div className="rounded-md border p-3 text-sm grid gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="secondary">
                  {summary.tracked.inserted} inserted
                </Badge>
                <Badge variant="secondary">
                  {summary.tracked.deleted} deleted
                </Badge>
                <Badge variant="secondary">
                  {summary.tracked.modified} modified
                </Badge>
                <span className="text-muted-foreground text-xs">
                  {summary.unchangedBlocks} blocks unchanged
                </span>
              </div>
              {totalTracked === 0 && summary.untracked.length === 0 && (
                <p className="text-muted-foreground">
                  The documents are identical.
                </p>
              )}
              {summary.untracked.length > 0 && (
                <div className="grid gap-1 max-h-32 overflow-y-auto">
                  <p className="font-medium text-amber-600 dark:text-amber-500">
                    {summary.untracked.length} change(s) not expressible as
                    tracked changes:
                  </p>
                  {summary.untracked.map((change, index) => (
                    <p key={index} className="text-xs text-muted-foreground">
                      {change.path} [{change.component}] {change.detail}
                    </p>
                  ))}
                </div>
              )}
              {summary.notes.map((note, index) => (
                <p key={index} className="text-xs text-muted-foreground">
                  Note: {note}
                </p>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          {summary && totalTracked + summary.untracked.length > 0 ? (
            <Button onClick={openRedline}>
              <FileDiff className="size-4 mr-1" />
              Open redline
            </Button>
          ) : (
            <Button
              onClick={runDiff}
              disabled={
                isDiffing ||
                !baseName ||
                !revisedName ||
                baseName === revisedName
              }
            >
              {isDiffing && <Spinner className="size-4 mr-1" />}
              Compare
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
