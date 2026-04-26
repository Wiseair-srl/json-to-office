import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  memo,
} from 'react';
import { InfoIcon } from 'lucide-react';
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
import { FORMAT, FORMAT_LABEL } from '../../lib/env';

/**
 * Tiny live countdown that ticks every 100ms and shows the
 * remaining debounce time before generation starts.
 * Renders nothing once the deadline is reached.
 */
const DebounceCountdown = memo(function DebounceCountdown({
  editTimestamp,
  debounceMs,
}: {
  editTimestamp: number;
  debounceMs: number;
}) {
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, editTimestamp + debounceMs - Date.now())
  );

  useEffect(() => {
    let id: ReturnType<typeof setInterval> | undefined;
    const tick = () => {
      const r = Math.max(0, editTimestamp + debounceMs - Date.now());
      setRemaining(r);
      if (r <= 0 && id != null) clearInterval(id);
    };
    tick();
    id = setInterval(tick, 100);
    return () => {
      if (id != null) clearInterval(id);
    };
  }, [editTimestamp, debounceMs]);

  if (remaining <= 0) return null;

  const secs = (remaining / 1000).toFixed(1);
  const pct = Math.min(100, (remaining / debounceMs) * 100);

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 tabular-nums">
      <span
        className="h-1 rounded-full bg-amber-500/60 transition-[width] duration-100"
        style={{ width: `${Math.round(pct * 0.4)}px` }}
      />
      {secs}s
    </span>
  );
});

export function Preview() {
  const {
    autoReload,
    renderingLibrary,
    saveDocumentDebounceWait,
    setSettings,
  } = useSettingsStore((state) => state);
  const {
    name,
    text,
    blob,
    isGenerating,
    generationProgress,
    globalError,
    cacheStatus,
    cacheHitRate,
    warnings,
    isRendering,
    isPreviewStale,
    editSequence,
    lastBuiltSequence,
    editTimestamp,
    hasValidationErrors,
    setOutput,
  } = useOutputStore((state) => state);
  const activeTab = useDocumentsStore((state) => state.activeTab);
  const documentTypes = useDocumentsStore((state) => state.documentTypes);
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
          renderingLibrary,
          undefined,
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
    [setOutput, cleanupRenderedPreview, renderingLibrary]
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

  // Auto-render when blob changes and docxjs + autoReload are active
  // Mark preview stale when blob changes but auto-render is OFF
  // Also render if a manual Run triggered the build (pendingManualRenderRef)
  useEffect(() => {
    if (blob && name && autoReload && renderingLibrary === 'docxjs') {
      doRender(name, blob, text, themesForServer);
    } else if (blob && name && pendingManualRenderRef.current) {
      pendingManualRenderRef.current = false;
      doRender(name, blob, text, themesForServer);
    } else if (blob && name) {
      setOutput({ isPreviewStale: true });
    }
  }, [
    blob,
    name,
    text,
    themesForServer,
    autoReload,
    renderingLibrary,
    doRender,
    setOutput,
  ]);

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

  return (
    <>
      <div className="flex h-full flex-col">
        {(useSettingsStore as any) &&
          (useSettingsStore as any).getState?.().useGlobalPreviewHeader ===
            false && (
            <PreviewHeaderMemoized
              iframeRef={iframeRef}
              displayReloadButton={
                Boolean(iframeSrc) && !(iframeSrc?.startsWith('blob:') ?? false)
              }
              name={name?.trim() || 'Preview'}
              blob={blob}
              autoReload={autoReload}
              onToggleAutoReload={() =>
                setSettings({ autoReload: !autoReload })
              }
              onManualRender={handleManualRender}
              isGenerating={isGenerating}
              isRendering={isRendering}
              onShowCacheMetrics={() => setShowCacheMetrics(true)}
              documentText={text}
              warnings={warnings}
              renderingLibrary={renderingLibrary}
              setRenderingLibrary={(lib) =>
                setSettings({ renderingLibrary: lib } as any)
              }
            />
          )}
        <Separator />
        {FORMAT === 'docx' && renderingLibrary === 'docxjs' && (
          <div className="px-3 py-1.5 flex items-center gap-2 border-b bg-blue-500/10 border-blue-500/30 text-xs text-blue-700 dark:text-blue-300">
            <InfoIcon className="h-3.5 w-3.5 shrink-0" />
            <span>
              The docxjs renderer is not 100% representative of the actual
              .docx. Use LibreOffice for higher fidelity.
            </span>
          </div>
        )}
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
                  isStale
                    ? 'bg-amber-500/10 border-amber-500/30'
                    : 'bg-muted/30'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0 truncate">
                  {cacheStatus === 'HIT' && !isStale ? (
                    <>
                      <div className="h-1.5 w-1.5 rounded-full bg-green-500 flex-shrink-0" />
                      <span className="text-xs text-muted-foreground truncate">
                        Cached
                      </span>
                    </>
                  ) : cacheStatus === 'MISS' && !isStale ? (
                    <>
                      <div className="h-1.5 w-1.5 rounded-full bg-orange-500 flex-shrink-0" />
                      <span className="text-xs text-muted-foreground truncate">
                        Fresh {FORMAT_LABEL.toLowerCase()}
                      </span>
                    </>
                  ) : isStale ? (
                    <>
                      <div className="h-1.5 w-1.5 rounded-full bg-amber-500 flex-shrink-0" />
                      <span className="text-xs text-amber-600 dark:text-amber-400 truncate">
                        Outdated — click Run
                      </span>
                      {editTimestamp &&
                        hasUnsyncedEdits &&
                        !isGenerating &&
                        !hasValidationErrors &&
                        autoReload &&
                        renderingLibrary === 'docxjs' && (
                          <DebounceCountdown
                            editTimestamp={editTimestamp}
                            debounceMs={saveDocumentDebounceWait + 200}
                          />
                        )}
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
            <div className="max-w-md rounded-lg border border-red-400/50 bg-red-400/10 px-4 py-3 text-sm text-red-400">
              <p className="font-medium mb-1">Generation failed</p>
              <p className="text-xs text-red-400/80 break-words">
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
            isGenerating={(() => {
              const willAutoBuild = autoReload && renderingLibrary === 'docxjs';
              const isSwitchingDoc =
                activeTab &&
                name &&
                activeTab !== name &&
                documentTypes[activeTab] !== 'application/json+theme';
              return (
                Boolean(isGenerating) ||
                Boolean(willAutoBuild && isSwitchingDoc)
              );
            })()}
            generationProgress={(() => {
              const willAutoBuild = autoReload && renderingLibrary === 'docxjs';
              const isSwitchingDoc =
                activeTab &&
                name &&
                activeTab !== name &&
                documentTypes[activeTab] !== 'application/json+theme';
              return willAutoBuild && isSwitchingDoc && !isGenerating
                ? {
                    stage: 'parsing' as const,
                    message: `Building preview for ${activeTab}...`,
                  }
                : generationProgress;
            })()}
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
