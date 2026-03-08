import React, { useEffect, useState } from 'react';
import { DocumentGenerationLoader, PreviewLoading } from '../ui/loading-states';
import { FORMAT_LABEL } from '../../lib/env';

const PreviewFrame = React.forwardRef<
  HTMLIFrameElement,
  {
    isLoading: boolean;
    iframeSrc?: string;
    iframeSrcDoc?: string;
    isGenerating?: boolean;
    generationProgress?: {
      stage: 'parsing' | 'building' | 'rendering' | 'finalizing';
      message?: string;
    };
  }
>(
  (
    {
      isLoading,
      iframeSrc,
      iframeSrcDoc,
      isGenerating,
      generationProgress,
    },
    ref
  ) => {
    const [iframeLoaded, setIframeLoaded] = useState(false);

    // Reset iframe loaded state when content changes
    useEffect(() => {
      setIframeLoaded(false);
    }, [iframeSrc, iframeSrcDoc]);

    // Handle iframe load event
    const handleIframeLoad = () => {
      setIframeLoaded(true);
    };

    // Handle iframe errors
    const handleIframeError = () => {
      console.warn('Iframe failed to load content');
      setIframeLoaded(false);
    };

    // PDF blob URLs and remote viewers can be blocked by Chromium-based browsers
    // when loaded in a sandboxed iframe. Keep sandbox only for srcDoc-based preview.
    const iframeSandbox = iframeSrcDoc
      ? 'allow-scripts allow-popups allow-forms'
      : undefined;

    // Show presentation generation loading state
    if (isGenerating) {
      return (
        <div className="grow">
          <DocumentGenerationLoader
            currentStage={generationProgress?.stage}
            message={generationProgress?.message}
          />
        </div>
      );
    }

    // Show preview rendering loading state
    if (isLoading) {
      return (
        <div className="grow">
          <PreviewLoading renderingLibrary="LibreOffice" />
        </div>
      );
    }

    if (iframeSrc || iframeSrcDoc) {
      return (
        <div className="h-full w-full relative bg-white">
          {/* Loading overlay */}
          {!iframeLoaded && (
            <div className="absolute inset-0 bg-muted/80 flex items-center justify-center z-10">
              <div className="text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground mx-auto mb-2"></div>
                <p className="text-sm text-muted-foreground">
                  Loading preview...
                </p>
              </div>
            </div>
          )}
          {/* Key forces remount when switching between srcDoc (sandboxed) and
              src (blob URL, no sandbox) to avoid stale sandbox race condition */}
          <iframe
            key={iframeSrcDoc ? 'srcdoc' : 'src'}
            ref={ref}
            className="w-full h-full border-0"
            style={{
              backgroundColor: 'white',
              // Fade in after load to prevent flash
              opacity: iframeLoaded ? 1 : 0,
              transition: 'opacity 0.2s ease-in-out',
            }}
            src={iframeSrc}
            srcDoc={iframeSrcDoc}
            onLoad={handleIframeLoad}
            onError={handleIframeError}
            // Security: sandbox srcDoc to prevent XSS from rendered HTML.
            // Blob URLs (src) must NOT be sandboxed without allow-same-origin.
            sandbox={iframeSandbox}
            // Accessibility
            title="Document preview"
            aria-label={`Preview of rendered ${FORMAT_LABEL.toLowerCase()}`}
          />
        </div>
      );
    }
    return null;
  }
);

PreviewFrame.displayName = 'PreviewFrame';
export const PreviewFrameMemoized = React.memo(PreviewFrame);
