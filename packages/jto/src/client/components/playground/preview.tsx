import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { PreviewFrameMemoized } from './preview-frame';
import { PreviewHeaderMemoized } from './preview-header';
import { WarningsPanel } from './warnings-panel';
import { UnavailableThemeWarning } from './unavailable-theme-warning';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Separator } from '../ui/separator';
import { useOutputStore } from '../../store/output-store-provider';
import { useSettingsStore } from '../../store/settings-store-provider';
import { renderDocument } from '../../lib/render';
import { useDocumentsStore } from '../../store/documents-store-provider';
import { useThemesStore } from '../../store/themes-store-provider';
import { CacheMetrics } from '../cache-metrics';
import { FORMAT_LABEL } from '../../lib/env';

export function Preview() {
  const {
    name,
    text,
    blob,
    isGenerating,
    generationProgress,
    generationStartedAt,
    cancelGeneration,
    globalError,
    cacheStatus,
    cacheHitRate,
    warnings,
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
      themes?: Record<string, unknown>
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
          themes
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
      doRender(name, blob, text, themesForServer);
      return;
    }
    setOutput({ isPreviewStale: true });
  }, [blob, name, text, themesForServer, doRender, setOutput]);

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
        {/* Status Bar: cache + stale combined */}
        {(() => {
          const hasUnsyncedEdits =
            (editSequence ?? 0) > (lastBuiltSequence ?? 0);
          const isStale =
            (isPreviewStale || hasUnsyncedEdits) &&
            !isGenerating &&
            !isRendering;
          return (
            ((cacheStatus && cacheStatus !== 'UNKNOWN') || isStale) && (
              <div
                className={`px-3 py-1.5 flex items-center justify-between border-b overflow-hidden ${
                  isStale ? 'bg-warning/10' : 'bg-header-bg'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0 truncate">
                  {cacheStatus === 'HIT' && !isStale ? (
                    <>
                      <div className="h-1.5 w-1.5 rounded-full bg-success flex-shrink-0" />
                      <span className="text-xs text-muted-foreground truncate">
                        Cached
                      </span>
                    </>
                  ) : cacheStatus === 'MISS' && !isStale ? (
                    <>
                      <div className="h-1.5 w-1.5 rounded-full bg-accent2 flex-shrink-0" />
                      <span className="text-xs text-muted-foreground truncate">
                        Fresh {FORMAT_LABEL.toLowerCase()}
                      </span>
                    </>
                  ) : isStale ? (
                    <>
                      <div className="h-1.5 w-1.5 rounded-full bg-warning flex-shrink-0" />
                      <span className="text-xs text-warning truncate">
                        Outdated — click Run
                      </span>
                    </>
                  ) : null}
                </div>
                {!isStale && cacheHitRate && cacheHitRate !== '0.0%' && (
                  <span className="text-xs text-muted-foreground flex-shrink-0 ml-2">
                    {cacheHitRate} hit rate
                  </span>
                )}
              </div>
            )
          );
        })()}
        {/* Warnings Panel */}
        <WarningsPanel warnings={warnings} className="mx-3 my-2" />
        <UnavailableThemeWarning className="mx-3 my-2" />
        {/* Generation Error — centered in preview area */}
        {globalError && !isGenerating ? (
          <div className="flex-1 flex items-center justify-center p-6">
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
