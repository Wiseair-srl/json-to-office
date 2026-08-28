import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { PreviewFrameMemoized } from './preview-frame';
import { PreviewHeaderMemoized } from './preview-header';
import { WarningsPanel } from './warnings-panel';
import { QualityControls } from './quality-controls';
import {
  hasQualityDetail,
  QualityFindings,
  QualitySummary,
} from './quality-panel';
import { UnavailableThemeWarning } from './unavailable-theme-warning';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Separator } from '../ui/separator';
import { useToast } from '../ui/use-toast';
import { useOutputStore } from '../../store/output-store-provider';
import { useSettingsStore } from '../../store/settings-store-provider';
import { renderDocument } from '../../lib/render';
import {
  DocumentsStoreContext,
  useDocumentsStore,
} from '../../store/documents-store-provider';
import { useEditorRefsStore } from '../../store/editor-refs-store';
import { useThemesStore } from '../../store/themes-store-provider';
import { useApplyQualityFix } from '../../hooks/useApplyQualityFix';
import { useQualityAnalysis } from '../../hooks/useQualityAnalysis';
import { findPointerRange } from '../../lib/json-pointer';
import {
  splitQualityWarnings,
  type QualityFinding,
} from '../../lib/quality-findings';
import { cn } from '../../lib/utils';
import { CacheMetrics } from '../cache-metrics';
import { FORMAT_LABEL } from '../../lib/env';

export function Preview() {
  const {
    name,
    text,
    blob,
    renderer,
    isGenerating,
    generationProgress,
    generationStartedAt,
    cancelGeneration,
    globalError,
    cacheStatus,
    cacheHitRate,
    warnings,
    quality,
    isRendering,
    isPreviewStale,
    editSequence,
    lastBuiltSequence,
    setOutput,
  } = useOutputStore((state) => state);
  // Editor text for "Copy standard components" — exists before the first Run,
  // unlike the output store's `text` (#155). Themes have no expansion.
  const editorDocumentText = useDocumentsStore((s) =>
    s.activeTab && s.documentTypes[s.activeTab] !== 'application/json+theme'
      ? s.documents.find((d) => d.name === s.activeTab)?.text
      : undefined
  );
  const documentsStore = useContext(DocumentsStoreContext)!;
  const { toast } = useToast();
  const applyQualityFix = useApplyQualityFix();
  const { analyze: analyzeQuality } = useQualityAnalysis();
  const [applyingFindingId, setApplyingFindingId] = useState<string | null>(
    null
  );
  const [showQualityControls, setShowQualityControls] = useState(false);
  const [showQualityFindings, setShowQualityFindings] = useState(false);
  const qualityDrawerId = React.useId();
  const activeTab = useDocumentsStore((s) => s.activeTab);

  // Findings address one document by JSON Pointer. A tab switch outruns the
  // analysis that follows it, so anything computed against another file is
  // withheld rather than shown over the file now on screen — its paths would
  // reveal the wrong nodes and its patches would edit the wrong document.
  const activeQuality = useMemo(
    () => (quality && quality.documentName === activeTab ? quality : null),
    [quality, activeTab]
  );

  const anyDrawerOpen = showQualityControls || showQualityFindings;
  const closeDrawers = useCallback(() => {
    setShowQualityControls(false);
    setShowQualityFindings(false);
  }, []);

  // Escape is what a reader reaches for when something is covering the page.
  useEffect(() => {
    if (!anyDrawerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeDrawers();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [anyDrawerOpen, closeDrawers]);

  // A gate the author asked for has refused their build; the reason is the
  // whole point of having asked, so it opens itself rather than waiting to be
  // found behind a summary row.
  const gateError = activeQuality?.gateError;
  useEffect(() => {
    if (gateError) setShowQualityFindings(true);
  }, [gateError]);

  // Close the findings drawer once there is nothing left in it — a document
  // that switched away, or one whose last finding was just fixed. Leaving it
  // open would hold an empty card over the page.
  const qualityHasDetail = hasQualityDetail(activeQuality);
  useEffect(() => {
    if (!qualityHasDetail) setShowQualityFindings(false);
  }, [qualityHasDetail]);

  // Quality findings ride in on the same `warnings` array as component
  // warnings; only the non-quality ones belong in the warnings bar. The
  // generate path already splits them, so this is the safety net for a
  // warnings list written by anything that does not.
  const otherWarnings = useMemo(
    () => splitQualityWarnings(warnings).others,
    [warnings]
  );

  // Jump to the finding's node in whichever editor is focused. The pointer is
  // resolved against the MODEL text, never `toStorageValue`: collapsed
  // long-string sentinels are ordinary JSON strings in the model, so model
  // offsets are the ones that match what is on screen.
  const revealPath = useCallback((path: string) => {
    // An empty pointer addresses the document root, which is never what a
    // malformed finding meant.
    if (!path) return;
    const editorRef = useEditorRefsStore.getState().getActiveEditor();
    if (!editorRef) return;
    const { editor, monaco } = editorRef;
    const model = editor.getModel();
    if (!model) return;
    const found = findPointerRange(model.getValue(), path);
    // An unresolvable pointer scrolls nowhere: jumping to offset 0 would look
    // like the finding pointed at the top of the file.
    if (!found) return;
    const start = model.getPositionAt(found.start);
    const end = model.getPositionAt(found.end);
    const range = new monaco.Range(
      start.lineNumber,
      start.column,
      end.lineNumber,
      end.column
    );
    editor.revealRangeNearTopIfOutsideViewport(
      range,
      monaco.editor.ScrollType.Smooth
    );
    editor.setPosition(start);
    editor.setSelection(range);
    editor.focus();
  }, []);

  // Applying is synchronous, so `applyingFindingId` never survives a render and
  // cannot disable the button. Without a lock a double-click applies the same
  // patch twice — and a second `remove` on the same array index deletes the
  // element that shifted into it. Ids clear when the next analysis replaces the
  // list, which is the point at which re-applying would mean something again.
  const appliedFindingIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    appliedFindingIdsRef.current = new Set();
  }, [quality?.seq]);

  const handleApplyFixes = useCallback(
    (finding: QualityFinding) => {
      if (appliedFindingIdsRef.current.has(finding.id)) return;
      appliedFindingIdsRef.current.add(finding.id);
      setApplyingFindingId(finding.id);
      try {
        const result = applyQualityFix(finding, quality?.documentName);
        if (!result.ok) {
          appliedFindingIdsRef.current.delete(finding.id);
          toast({
            variant: 'destructive',
            title: 'Could not apply fix',
            description: result.error,
          });
          return;
        }
        // Re-read rather than reusing the text the fix was computed from: the
        // panel must describe the repaired document, and the stale text would
        // reinstate the finding that was just fixed.
        const { activeTab: tab, documents } = documentsStore.getState();
        const repaired = documents.find((d) => d.name === tab)?.text;
        if (repaired) analyzeQuality(tab, repaired, { immediate: true });
      } finally {
        setApplyingFindingId(null);
      }
    },
    [
      analyzeQuality,
      applyQualityFix,
      documentsStore,
      quality?.documentName,
      toast,
    ]
  );
  // Select the raw map (stable reference until themes mutate), then memoize
  // the transform. A selector that returns a freshly-constructed object on
  // every call would burn through Zustand's Object.is equality and retrigger
  // renders indefinitely.
  const customThemesMap = useThemesStore((state) => state.customThemes);
  const themesForServer = useMemo(() => {
    const out: Record<string, unknown> = {};
    for (const ct of Object.values(customThemesMap)) {
      if (ct.valid && ct.name && ct.parsed) out[ct.name] = ct.parsed;
    }
    return out;
  }, [customThemesMap]);

  const [iframeSrc, setIframeSrc] = useState<string | undefined>(undefined);
  const [iframeSrcDoc, setIframeSrcDoc] = useState<string | undefined>(
    undefined
  );
  const [showCacheMetrics, setShowCacheMetrics] = useState<boolean>(false);
  const iframeRef = React.useRef<HTMLIFrameElement>(null);

  const renderCleanupRef = useRef<(() => void) | null>(null);
  const pendingManualRenderRef = useRef(false);

  const cleanupRenderedPreview = useCallback(() => {
    if (renderCleanupRef.current) {
      renderCleanupRef.current();
      renderCleanupRef.current = null;
    }
  }, []);

  // Core render function
  const doRender = useCallback(
    async (
      docName: string,
      docBlob: Blob,
      docText?: string,
      themes?: Record<string, unknown>,
      renderer?: string
    ) => {
      setOutput({
        isRendering: true,
        isPreviewStale: false,
        globalError: undefined,
      });

      try {
        const { status, payload } = await renderDocument(
          docName,
          docBlob,
          docText,
          themes,
          renderer
        );

        if (status !== 'success') {
          throw payload instanceof Error ? payload : new Error(String(payload));
        }

        cleanupRenderedPreview();
        setIframeSrc(payload.iframeSrc || undefined);
        setIframeSrcDoc(payload.iframeSrcDoc || undefined);
        renderCleanupRef.current = payload.cleanup || null;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        let displayMessage = errorMessage;
        if (errorMessage.includes('Failed to fetch')) {
          displayMessage =
            'Network error: Unable to load required resources. Check if the server is running properly.';
        } else if (errorMessage.includes('timeout')) {
          displayMessage =
            'Render timeout: The rendering process took too long.';
        }

        setOutput({ globalError: displayMessage });
      } finally {
        setOutput({ isRendering: false });
      }
    },
    [setOutput, cleanupRenderedPreview]
  );

  // Ref to always hold latest manual-render deps so the event listener never goes stale
  const manualRenderRef = useRef({ name, blob, text, doRender });
  useEffect(() => {
    manualRenderRef.current = { name, blob, text, doRender };
  });

  const handleManualRender = useCallback(async () => {
    // Set flag so blob-change effect renders the new blob when it arrives
    pendingManualRenderRef.current = true;
    // Flush debounces + trigger build via editor.tsx
    window.dispatchEvent(new CustomEvent('preview:flushAndBuild'));
  }, []); // stable — reads from ref

  // A new blob renders only when a Run asked for it. Converting through
  // LibreOffice costs a round trip, so an edit marks the preview stale and
  // waits rather than rebuilding under the author.
  useEffect(() => {
    if (!blob || !name) return;
    if (pendingManualRenderRef.current) {
      pendingManualRenderRef.current = false;
      // Use the backend captured with this blob, never the live picker: the
      // selection may have changed while generation was in flight (#255).
      doRender(name, blob, text, themesForServer, renderer);
      return;
    }
    setOutput({ isPreviewStale: true });
  }, [blob, name, text, themesForServer, renderer, doRender, setOutput]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupRenderedPreview();
    };
  }, [cleanupRenderedPreview]);

  // Listen for global header events (stable — handleManualRender never changes)
  useEffect(() => {
    const onManual = () => handleManualRender();
    const onShowCache = () => setShowCacheMetrics(true);

    window.addEventListener('preview:manualRender', onManual);
    window.addEventListener('preview:showCacheMetrics', onShowCache);
    return () => {
      window.removeEventListener('preview:manualRender', onManual);
      window.removeEventListener('preview:showCacheMetrics', onShowCache);
    };
  }, [handleManualRender]);

  const localHeaderVisible =
    (useSettingsStore as any)?.getState?.().useGlobalPreviewHeader === false;

  return (
    <>
      <div className="flex h-full flex-col">
        {localHeaderVisible && (
          <PreviewHeaderMemoized
            name={name?.trim() || 'Preview'}
            blob={blob}
            onManualRender={handleManualRender}
            isGenerating={isGenerating}
            isRendering={isRendering}
            onShowCacheMetrics={() => setShowCacheMetrics(true)}
            documentText={text}
            editorDocumentText={editorDocumentText}
            warnings={warnings}
          />
        )}
        {/* The local header draws its own `border-b`; a standalone separator
            underneath it stacked two hairlines. */}
        {!localHeaderVisible && <Separator />}
        {/* One status strip, not two. Build state and quality state describe
            the same document at the same moment, and stacking them cost two
            hairlines and two rows of height above the page being read.
            Segments carry their own colour instead of the row carrying a
            tint, so a stale build and a failing gate can be shown at once
            without two backgrounds competing. */}
        {(() => {
          const hasUnsyncedEdits =
            (editSequence ?? 0) > (lastBuiltSequence ?? 0);
          const isStale =
            (isPreviewStale || hasUnsyncedEdits) &&
            !isGenerating &&
            !isRendering;
          const buildStatus = isStale ? (
            <>
              <div className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-warning" />
              <span className="truncate text-xs text-warning">
                Outdated — click Run
              </span>
            </>
          ) : cacheStatus === 'HIT' ? (
            <>
              <div className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-success" />
              <span className="truncate text-xs text-muted-foreground">
                Cached
              </span>
            </>
          ) : cacheStatus === 'MISS' ? (
            <>
              <div className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent2" />
              <span className="truncate text-xs text-muted-foreground">
                Fresh {FORMAT_LABEL.toLowerCase()}
              </span>
            </>
          ) : null;
          const showBuildStatus =
            Boolean(buildStatus) &&
            ((cacheStatus && cacheStatus !== 'UNKNOWN') || isStale);

          return (
            <div className="flex items-center gap-2 overflow-hidden border-b bg-header-bg px-3 py-1.5">
              {showBuildStatus && (
                <div className="flex min-w-0 flex-shrink items-center gap-2">
                  {buildStatus}
                </div>
              )}
              {showBuildStatus && activeQuality && (
                <div
                  aria-hidden="true"
                  className="h-3 w-px flex-shrink-0 bg-border"
                />
              )}
              <QualitySummary
                quality={activeQuality}
                open={showQualityFindings}
                onToggle={() => setShowQualityFindings((open) => !open)}
                controlsId={qualityDrawerId}
                className="min-w-0 flex-1"
              />
              {/* The hit rate is a diagnostic, so it is the first thing to go
                  when the row runs out of width; the full figures live in the
                  cache dialog. */}
              {!isStale && cacheHitRate && cacheHitRate !== '0.0%' && (
                <span className="hidden flex-shrink-0 text-xs text-muted-foreground lg:inline">
                  {cacheHitRate} hit rate
                </span>
              )}
              <button
                type="button"
                onClick={() => setShowQualityControls(!showQualityControls)}
                aria-expanded={showQualityControls}
                className={cn(
                  'flex flex-shrink-0 items-center gap-1.5 rounded-sm px-1.5 py-0.5',
                  'text-[11px] font-medium text-muted-foreground',
                  'transition-colors hover:bg-accent hover:text-foreground',
                  'focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none'
                )}
              >
                <SlidersHorizontal className="h-3 w-3" aria-hidden="true" />
                <span className="hidden sm:inline">Quality settings</span>
              </button>
            </div>
          );
        })()}
        {/* Warnings Panel */}
        <WarningsPanel warnings={otherWarnings} className="mx-3 my-2" />
        <UnavailableThemeWarning className="mx-3 my-2" />
        {/* The drawers float over this region rather than sitting above it in
            the column. Quality re-analyses on every pause in typing, and a
            panel in flow would shove the page the author is reading down the
            screen each time a finding appeared or cleared. */}
        <div className="relative min-h-0 flex-1">
          {/* Generation Error — centered in preview area */}
          {globalError && !isGenerating ? (
            <div className="flex h-full items-center justify-center p-6">
              <div className="max-w-md rounded-sm border-l-4 border-l-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive">
                <p className="font-medium mb-1">Generation failed</p>
                <p className="text-xs text-destructive/80 break-words">
                  {globalError}
                </p>
              </div>
            </div>
          ) : (
            <PreviewFrameMemoized
              ref={iframeRef}
              isLoading={Boolean(isRendering)}
              iframeSrc={iframeSrc}
              iframeSrcDoc={iframeSrcDoc}
              isGenerating={Boolean(isGenerating)}
              generationProgress={generationProgress}
              generationDocumentText={editorDocumentText ?? text}
              generationStartedAt={generationStartedAt}
              onCancelGeneration={cancelGeneration}
            />
          )}

          {anyDrawerOpen && (
            <>
              {/* Catches the click that dismisses. Transparent, so the page
                  stays legible behind an open drawer. */}
              <div
                className="absolute inset-0 z-30"
                onClick={closeDrawers}
                aria-hidden="true"
              />
              <div
                className={cn(
                  // Pinned top and bottom rather than capped: a long findings
                  // list gets the whole pane to scroll inside, and the drawer
                  // stops looking like a tooltip that ran out of room.
                  'absolute inset-x-3 top-2 bottom-2 z-40 overflow-y-auto',
                  'rounded-sm border bg-card p-4 shadow-lg'
                )}
              >
                {showQualityControls && <QualityControls />}
                {showQualityControls && showQualityFindings && (
                  <div className="my-4 border-t" />
                )}
                {showQualityFindings && (
                  <QualityFindings
                    id={qualityDrawerId}
                    quality={activeQuality}
                    onRevealPath={revealPath}
                    onApplyFixes={handleApplyFixes}
                    applyingFindingId={applyingFindingId}
                  />
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Cache Metrics Dialog */}
      <Dialog open={showCacheMetrics} onOpenChange={setShowCacheMetrics}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Cache Performance</DialogTitle>
          </DialogHeader>
          <CacheMetrics />
        </DialogContent>
      </Dialog>
    </>
  );
}
