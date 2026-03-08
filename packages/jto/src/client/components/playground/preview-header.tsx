import React, { useState, useCallback } from 'react';
import {
  SaveIcon,
  RefreshCwIcon,
  InfoIcon,
  PlayIcon,
  BarChart3Icon,
  FileJson,
  Trash2Icon,
  Code2,
  AlertTriangle,
} from 'lucide-react';
import { Spinner } from '../ui/spinner';
import { Button } from '../ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { Switch } from '../ui/switch';
import { Label } from '../ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { download } from '../../lib/download';
import { apiClient } from '../../api/client';
import { useToast } from '../ui/use-toast';
import { usePresentationGenerator } from '../../hooks/usePresentationGenerator';
import { buildWarningsDocumentJson } from '../../lib/warnings-document-builder';
import type { GenerationWarning } from '../../store/output-store';
import { FORMAT, FORMAT_EXT, FORMAT_LABEL } from '../../lib/env';
import { API_ENDPOINTS } from '../../config/api';
import type { RenderingLibrary } from '../../lib/types';

const RENDERING_LIBRARIES: RenderingLibrary[] =
  FORMAT === 'docx'
    ? ['docxjs', 'LibreOffice']
    : ['LibreOffice'];

const tooltips: Record<RenderingLibrary, [string, string]> = {
  docxjs: ['⚡', '(Recommended) works in the browser'],
  LibreOffice: [
    '🖨️',
    '(High fidelity) converts to PDF locally with LibreOffice',
  ],
};

function PreviewHeader({
  name,
  blob,
  displayReloadButton,
  iframeRef,
  autoReload,
  onToggleAutoReload,
  onManualRender,
  isGenerating,
  isRendering,
  onShowCacheMetrics,
  onShowSchemas,
  documentText,
  warnings,
  renderingLibrary,
  setRenderingLibrary,
}: {
  name: string;
  blob?: Blob;
  displayReloadButton: boolean;
  iframeRef?: React.RefObject<HTMLIFrameElement | null>;
  autoReload: boolean;
  onToggleAutoReload: () => void;
  onManualRender: () => void;
  isGenerating?: boolean;
  isRendering?: boolean;
  onShowCacheMetrics?: () => void;
  onShowSchemas?: () => void;
  documentText?: string;
  warnings?: GenerationWarning[] | null;
  renderingLibrary?: RenderingLibrary;
  setRenderingLibrary?: (lib: RenderingLibrary) => void;
}) {
  const usesManualRenderByDefault =
    renderingLibrary !== 'docxjs';
  const [isDownloading, setIsDownloading] = useState(false);
  const [isDownloadingWarnings, setIsDownloadingWarnings] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [isCopyingStandardComponents, setIsCopyingStandardComponents] =
    useState(false);
  const { toast } = useToast();
  const { generatePresentation } = usePresentationGenerator();

  const handleDownload = useCallback(async () => {
    if (!blob) return;
    setIsDownloading(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 100)); // Brief delay for UX
      download(`${name}${FORMAT_EXT}`, blob);
    } finally {
      setTimeout(() => setIsDownloading(false), 500); // Keep loading state briefly
    }
  }, [blob, name]);

  const handleDownloadWarnings = useCallback(async () => {
    if (!warnings || warnings.length === 0) return;

    setIsDownloadingWarnings(true);
    try {
      // Build warnings document JSON
      const warningsDocJson = buildWarningsDocumentJson(warnings);
      if (!warningsDocJson) {
        toast({
          title: 'No warnings',
          description: 'There are no warnings to download.',
          variant: 'destructive',
        });
        return;
      }

      // Generate PPTX from warnings document JSON
      // Pass empty customThemes to ensure we use built-in themes only
      const result = await generatePresentation(
        'warnings',
        JSON.stringify(warningsDocJson, null, 2),
        {} // Empty customThemes to avoid conflicts with user's custom themes
      );

      if (
        result &&
        typeof result === 'object' &&
        'blob' in result &&
        result.blob
      ) {
        // Download the generated warnings document
        download(`${name}-warnings${FORMAT_EXT}`, result.blob as Blob);
        toast({
          title: 'Warnings downloaded',
          description: `Downloaded warnings document with ${warnings.length} warning(s).`,
        });
      }
    } catch (error) {
      console.error('Failed to generate warnings document:', error);
      toast({
        title: 'Download failed',
        description:
          error instanceof Error
            ? error.message
            : 'Failed to generate warnings document',
        variant: 'destructive',
      });
    } finally {
      setTimeout(() => setIsDownloadingWarnings(false), 500);
    }
  }, [warnings, name, generatePresentation, toast]);

  const handleReload = useCallback(async () => {
    const iframeEl = iframeRef?.current;
    if (!iframeEl?.src) return;

    setIsReloading(true);

    try {
      // Create a promise that resolves when iframe loads or times out
      const reloadPromise = new Promise<void>((resolve) => {
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        let resolved = false;

        const cleanup = () => {
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
          iframeEl.removeEventListener('load', onLoad);
          iframeEl.removeEventListener('error', onError);
        };

        const resolveOnce = () => {
          if (!resolved) {
            resolved = true;
            cleanup();
            resolve();
          }
        };

        const onLoad = () => resolveOnce();
        const onError = () => resolveOnce();

        // Add event listeners
        iframeEl.addEventListener('load', onLoad);
        iframeEl.addEventListener('error', onError);

        // Set fallback timeout
        timeoutId = setTimeout(() => {
          console.warn('Iframe reload timed out after 5 seconds');
          resolveOnce();
        }, 5000);

        // Trigger reload by modifying src with timestamp to ensure actual reload
        const originalSrc = iframeEl.src;
        const separator = originalSrc.includes('?') ? '&' : '?';
        const timestamp = Date.now();
        iframeEl.src = `${originalSrc}${separator}_reload=${timestamp}`;
      });

      await reloadPromise;
    } catch (error) {
      console.error('Iframe reload failed:', error);
    } finally {
      setIsReloading(false);
    }
  }, [iframeRef]);

  const handleClearCache = useCallback(async () => {
    setIsClearingCache(true);
    try {
      await apiClient.delete(`/${FORMAT}/cache`);
      // Trigger a custom event to refresh cache metrics if they're open
      window.dispatchEvent(new CustomEvent('cache:cleared'));

      // Show success toast
      toast({
        title: 'Cache Cleared',
        description:
          'All caches (document and component) have been successfully cleared.',
        variant: 'default',
      });
    } catch (error) {
      console.error('Failed to clear cache:', error);

      // Show error toast
      toast({
        title: 'Cache Clear Failed',
        description: 'Failed to clear caches. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsClearingCache(false);
    }
  }, [toast]);

  const handleCopyStandardComponents = useCallback(async () => {
    if (!documentText) {
      toast({
        title: 'No document available',
        description: 'Please select a document to copy standard components',
        variant: 'destructive',
      });
      return;
    }

    setIsCopyingStandardComponents(true);
    try {
      const response = await fetch(`/api/${FORMAT}/standard-components`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonDefinition: documentText,
        }),
      });

      if (!response.ok) {
        let description = `Request failed with status ${response.status}`;
        try {
          const errorData = await response.json();
          if (errorData.message) description = errorData.message;
        } catch {}
        toast({
          title: 'Failed to get standard components',
          description,
          variant: 'destructive',
        });
        return;
      }

      const result = await response.json();
      const standardComponentsJson = JSON.stringify(result.data, null, 2);

      await navigator.clipboard.writeText(standardComponentsJson);

      toast({
        title: 'Copied to clipboard',
        description: 'Standard modules JSON has been copied',
      });
    } catch (error) {
      console.error('Error copying standard components:', error);
      toast({
        title: 'Error',
        description:
          error instanceof Error
            ? error.message
            : 'Failed to copy standard components',
        variant: 'destructive',
      });
    } finally {
      setIsCopyingStandardComponents(false);
    }
  }, [documentText, toast]);

  return (
    <>
      <div className="bg-sidebar flex flex-row flex-nowrap items-center justify-between gap-x-3 p-2">
        <div className="flex items-center gap-2">
          <p className="text-muted-foreground text-sm font-medium truncate max-w-[40vw]">
            {name}
          </p>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Preview disclaimer"
                className="cursor-help inline-flex items-center justify-center h-6 w-6 rounded hover:bg-muted/60"
              >
                <InfoIcon className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-sm">
              <p className="text-sm">
                Preview uses {FORMAT === 'docx' ? 'docx-preview' : 'LibreOffice PDF conversion'}. Download the {FORMAT_EXT} to
                verify fidelity.
              </p>
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="flex flex-row gap-x-2 flex-shrink-0">
          {FORMAT === 'docx' && (
            <div className="flex items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-2 cursor-help">
                    <Label className="text-xs text-muted-foreground">
                      Auto-reload
                    </Label>
                    <Switch
                      checked={autoReload}
                      onCheckedChange={onToggleAutoReload}
                      disabled={usesManualRenderByDefault}
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p>
                    {usesManualRenderByDefault
                      ? 'Auto-reload is not available for Office, Docs, and LibreOffice renderers'
                      : `${autoReload ? 'Disable' : 'Enable'} automatic preview reload on content changes`}
                  </p>
                </TooltipContent>
              </Tooltip>
            </div>
          )}
          {(!autoReload || usesManualRenderByDefault) && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="bg-sidebar text-sidebar-foreground"
                  onClick={onManualRender}
                  aria-label="Render preview"
                  disabled={!blob || isGenerating || isRendering}
                >
                  {isRendering ? <Spinner size="sm" /> : <PlayIcon />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>
                  {isRendering ? 'Rendering preview...' : 'Render preview'}
                </p>
              </TooltipContent>
            </Tooltip>
          )}
          {displayReloadButton && autoReload && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="bg-sidebar text-sidebar-foreground"
                  onClick={handleReload}
                  disabled={isReloading || isGenerating || isRendering}
                >
                  {isReloading ? <Spinner size="sm" /> : <RefreshCwIcon />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{isReloading ? 'Reloading...' : 'Reload'}</p>
              </TooltipContent>
            </Tooltip>
          )}

          {onShowSchemas && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="bg-sidebar text-sidebar-foreground"
                  onClick={onShowSchemas}
                >
                  <FileJson />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>View JSON Schemas</p>
              </TooltipContent>
            </Tooltip>
          )}

          {onShowCacheMetrics && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="bg-sidebar text-sidebar-foreground"
                  onClick={onShowCacheMetrics}
                >
                  <BarChart3Icon />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>View cache metrics</p>
              </TooltipContent>
            </Tooltip>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="bg-sidebar text-sidebar-foreground"
                onClick={handleClearCache}
                disabled={isClearingCache}
              >
                {isClearingCache ? <Spinner size="sm" /> : <Trash2Icon />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>
                {isClearingCache ? 'Clearing cache...' : 'Clear all caches'}
              </p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="bg-sidebar text-sidebar-foreground"
                disabled={!documentText || isCopyingStandardComponents}
                onClick={handleCopyStandardComponents}
              >
                {isCopyingStandardComponents ? (
                  <Spinner size="sm" />
                ) : (
                  <Code2 />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Copy standard components JSON</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="bg-sidebar text-sidebar-foreground"
                disabled={!blob || isDownloading || isGenerating}
                onClick={handleDownload}
              >
                {isDownloading ? <Spinner size="sm" /> : <SaveIcon />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Download {FORMAT_EXT}</p>
            </TooltipContent>
          </Tooltip>

          {/* Download Warnings Button - Only show when warnings exist */}
          {warnings && warnings.length > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="bg-amber-50 dark:bg-amber-950 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800 hover:bg-amber-100 dark:hover:bg-amber-900"
                  disabled={isDownloadingWarnings || isGenerating}
                  onClick={handleDownloadWarnings}
                >
                  {isDownloadingWarnings ? (
                    <Spinner size="sm" />
                  ) : (
                    <AlertTriangle className="h-4 w-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Download warnings ({warnings.length})</p>
              </TooltipContent>
            </Tooltip>
          )}

          {renderingLibrary && setRenderingLibrary && (
            <Select value={renderingLibrary} onValueChange={setRenderingLibrary}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <SelectTrigger className="w-[168px]">
                    <SelectValue placeholder="Select a library" />
                  </SelectTrigger>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Select the rendering library</p>
                </TooltipContent>
              </Tooltip>
              <SelectContent className="text-sidebar-foreground">
                {RENDERING_LIBRARIES.map((library) => (
                  <SelectItem value={library} key={library}>
                    <Tooltip>
                      <TooltipTrigger tabIndex={-1}>
                        {tooltips[library][0]}
                      </TooltipTrigger>
                      <TooltipContent>
                        {tooltips[library][1]}
                      </TooltipContent>
                    </Tooltip>{' '}
                    {library}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>
    </>
  );
}

export const PreviewHeaderMemoized = React.memo(PreviewHeader);
