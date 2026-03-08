import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { PreviewFrameMemoized } from './preview-frame';
import { PreviewHeaderMemoized } from './preview-header';
import { WarningsPanel } from './warnings-panel';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Separator } from '../ui/separator';
import { useOutputStore } from '../../store/output-store-provider';
import { useSettingsStore } from '../../store/settings-store-provider';
import { renderDocument } from '../../lib/render';
import { useDocumentsStore } from '../../store/documents-store-provider';
import { CacheMetrics } from '../cache-metrics';
import { FORMAT_LABEL } from '../../lib/env';


export function Preview() {
  const { autoReload, renderingLibrary, setSettings } = useSettingsStore((state) => state);
  const {
    name,
    text,
    blob,
    isGenerating,
    generationProgress,
    cacheStatus,
    cacheHitRate,
    warnings,
    setOutput,
  } = useOutputStore((state) => state);
  const activeTab = useDocumentsStore((state) => state.activeTab);
  const documentTypes = useDocumentsStore((state) => state.documentTypes);

  const [isRendering, setIsRendering] = useState(false);
  const [iframeSrc, setIframeSrc] = useState<string | undefined>(undefined);
  const [iframeSrcDoc, setIframeSrcDoc] = useState<string | undefined>(
    undefined
  );
  const [showCacheMetrics, setShowCacheMetrics] = useState<boolean>(false);
  const iframeRef = React.useRef<HTMLIFrameElement>(null);

  const renderCleanupRef = useRef<(() => void) | null>(null);

  const cleanupRenderedPreview = useCallback(() => {
    if (renderCleanupRef.current) {
      renderCleanupRef.current();
      renderCleanupRef.current = null;
    }
  }, []);

  // Track document switches and clear preview when switching to a different document
  useEffect(() => {
    const isActiveTabTheme =
      activeTab && documentTypes[activeTab] === 'application/json+theme';

    if (name && activeTab && name !== activeTab && !isActiveTabTheme) {
      cleanupRenderedPreview();
      setIframeSrc(undefined);
      setIframeSrcDoc(undefined);
    }
  }, [name, activeTab, documentTypes, cleanupRenderedPreview]);

  // Core render function
  const doRender = useCallback(
    async (docName: string, docBlob: Blob) => {
      setIsRendering(true);
      setOutput({ globalError: undefined });

      try {
        const { status, payload } = await renderDocument(
          docName,
          docBlob,
          renderingLibrary,
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
        setIsRendering(false);
      }
    },
    [setOutput, cleanupRenderedPreview, renderingLibrary]
  );

  const handleManualRender = useCallback(async () => {
    if (name && blob) {
      await doRender(name, blob);
    }
  }, [name, blob, doRender]);

  // Auto-render when blob changes and docxjs + autoReload are active
  useEffect(() => {
    if (blob && name && autoReload && renderingLibrary === 'docxjs') {
      doRender(name, blob);
    }
  }, [blob, name, autoReload, renderingLibrary, doRender]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupRenderedPreview();
    };
  }, [cleanupRenderedPreview]);

  // Listen for global header events
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
              name={name?.trim() || `Preview`}
              blob={blob}
              autoReload={autoReload}
              onToggleAutoReload={() => setSettings({ autoReload: !autoReload })}
              onManualRender={handleManualRender}
              isGenerating={isGenerating}
              isRendering={isRendering}
              onShowCacheMetrics={() => setShowCacheMetrics(true)}
              documentText={text}
              warnings={warnings}
              renderingLibrary={renderingLibrary}
              setRenderingLibrary={(lib) => setSettings({ renderingLibrary: lib } as any)}
            />
          )}
        <Separator />
        {/* Cache Status Indicator */}
        {cacheStatus && cacheStatus !== 'UNKNOWN' && (
          <div className="px-3 py-2 flex items-center justify-between bg-muted/50 border-b">
            <div className="flex items-center gap-2">
              {cacheStatus === 'HIT' ? (
                <>
                  <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-sm text-muted-foreground">
                    Served from cache
                  </span>
                </>
              ) : (
                <>
                  <div className="h-2 w-2 rounded-full bg-orange-500" />
                  <span className="text-sm text-muted-foreground">
                    Generated fresh {FORMAT_LABEL.toLowerCase()}
                  </span>
                </>
              )}
            </div>
            {cacheHitRate && (
              <span className="text-sm text-muted-foreground">
                Cache hit rate: {cacheHitRate}
              </span>
            )}
          </div>
        )}
        {/* Warnings Panel */}
        <WarningsPanel warnings={warnings} className="mx-3 my-2" />
        <PreviewFrameMemoized
          ref={iframeRef}
          isLoading={isRendering && !iframeSrc && !iframeSrcDoc}
          iframeSrc={iframeSrc}
          iframeSrcDoc={iframeSrcDoc}
          isGenerating={
            (isGenerating && !blob) ||
            Boolean(
              activeTab &&
                name &&
                activeTab !== name &&
                documentTypes[activeTab] !== 'application/json+theme'
            )
          }
          generationProgress={
            activeTab &&
            name &&
            activeTab !== name &&
            documentTypes[activeTab] !== 'application/json+theme'
              ? {
                  stage: 'parsing',
                  message: `Building preview for ${activeTab}...`,
                }
              : generationProgress
          }
        />
      </div>

      {/* Cache Metrics Dialog */}
      <Dialog open={showCacheMetrics} onOpenChange={setShowCacheMetrics}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Cache Performance</DialogTitle>
            <DialogDescription>
              Document and module-level cache statistics
            </DialogDescription>
          </DialogHeader>
          <CacheMetrics />
        </DialogContent>
      </Dialog>
    </>
  );
}
