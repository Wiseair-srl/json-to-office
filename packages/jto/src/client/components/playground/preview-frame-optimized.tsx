import React, { useRef, useEffect, useState, useCallback } from 'react';
import { ScrollArea } from '../ui/scroll-area';
import { DocumentGenerationLoader, PreviewLoading } from '../ui/loading-states';

interface PreviewFrameProps {
  isLoading: boolean;
  iframeSrc?: string;
  iframeSrcDoc?: string;
  isGenerating?: boolean;
  generationProgress?: {
    stage: 'parsing' | 'building' | 'rendering' | 'finalizing';
    message?: string;
  };
  onIframeReady?: (iframe: HTMLIFrameElement) => void;
}

// Pool of reusable iframes
class IframePool {
  private pool: HTMLIFrameElement[] = [];
  private inUse: Set<HTMLIFrameElement> = new Set();
  private readonly maxSize = 3;

  acquire(): HTMLIFrameElement {
    // Try to get an available iframe from the pool
    const available = this.pool.find((iframe) => !this.inUse.has(iframe));

    if (available) {
      this.inUse.add(available);
      return available;
    }

    // Create new iframe if pool isn't full
    if (this.pool.length < this.maxSize) {
      const iframe = this.createIframe();
      this.pool.push(iframe);
      this.inUse.add(iframe);
      return iframe;
    }

    // Force reuse the oldest iframe
    const oldest = this.pool[0];
    this.reset(oldest);
    this.inUse.add(oldest);
    return oldest;
  }

  release(iframe: HTMLIFrameElement): void {
    this.inUse.delete(iframe);
    this.reset(iframe);
  }

  private createIframe(): HTMLIFrameElement {
    const iframe = document.createElement('iframe');
    iframe.className = 'h-full w-full';
    iframe.style.border = 'none';
    iframe.sandbox.add('allow-scripts', 'allow-popups');
    iframe.setAttribute('data-pooled', 'true');
    return iframe;
  }

  private reset(iframe: HTMLIFrameElement): void {
    try {
      iframe.src = 'about:blank';
      iframe.srcdoc = '';
    } catch (error) {
      console.warn('Error resetting iframe:', error);
    }
  }

  destroy(): void {
    this.pool.forEach((iframe) => {
      if (iframe.parentNode) {
        iframe.parentNode.removeChild(iframe);
      }
    });
    this.pool = [];
    this.inUse.clear();
  }
}

// Global iframe pool
const iframePool = new IframePool();

export const PreviewFrameOptimized = React.memo<PreviewFrameProps>(
  ({
    isLoading,
    iframeSrc,
    iframeSrcDoc,
    isGenerating,
    generationProgress,
    onIframeReady,
  }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const currentIframeRef = useRef<HTMLIFrameElement | null>(null);
    const [iframeReady, setIframeReady] = useState(false);
    const lastContentRef = useRef<{ src?: string; srcDoc?: string }>({});

    // Update iframe content
    const updateIframeContent = useCallback(
      (iframe: HTMLIFrameElement, src?: string, srcDoc?: string) => {
        // Skip if content hasn't changed
        if (
          lastContentRef.current.src === src &&
          lastContentRef.current.srcDoc === srcDoc
        ) {
          return;
        }

        lastContentRef.current = { src, srcDoc };

        // Use requestAnimationFrame for smooth updates
        requestAnimationFrame(() => {
          try {
            if (srcDoc) {
              // For srcdoc, check if we can reuse the existing document
              if (iframe.contentDocument && iframe.srcdoc) {
                // Try to update existing document instead of replacing
                const parser = new DOMParser();
                const newDoc = parser.parseFromString(srcDoc, 'text/html');

                // Only update if significantly different
                if (
                  iframe.contentDocument.documentElement.innerHTML.length !==
                  newDoc.documentElement.innerHTML.length
                ) {
                  iframe.srcdoc = srcDoc;
                }
              } else {
                iframe.srcdoc = srcDoc;
              }
            } else if (src) {
              // Only update src if it's actually different
              if (iframe.src !== src) {
                iframe.src = src;
              }
            }
          } catch (error) {
            console.error('Error updating iframe content:', error);
            // Fallback to standard update
            if (srcDoc) {
              iframe.srcdoc = srcDoc;
            } else if (src) {
              iframe.src = src;
            }
          }
        });
      },
      []
    );

    // Setup iframe when content is available
    useEffect(() => {
      if (
        !containerRef.current ||
        (!iframeSrc && !iframeSrcDoc) ||
        isGenerating ||
        isLoading
      ) {
        return;
      }

      // Acquire iframe from pool
      const iframe = iframePool.acquire();
      currentIframeRef.current = iframe;

      // Setup load handler
      const handleLoad = () => {
        setIframeReady(true);
        if (onIframeReady) {
          onIframeReady(iframe);
        }
      };

      iframe.addEventListener('load', handleLoad);

      // Add iframe to container
      containerRef.current.appendChild(iframe);

      // Update content
      updateIframeContent(iframe, iframeSrc, iframeSrcDoc);

      // Cleanup
      return () => {
        iframe.removeEventListener('load', handleLoad);
        if (iframe.parentNode) {
          iframe.parentNode.removeChild(iframe);
        }
        iframePool.release(iframe);
        currentIframeRef.current = null;
        setIframeReady(false);
      };
    }, [
      iframeSrc,
      iframeSrcDoc,
      isGenerating,
      isLoading,
      updateIframeContent,
      onIframeReady,
    ]);

    // Update content when it changes (without recreating iframe)
    useEffect(() => {
      if (currentIframeRef.current && !isGenerating && !isLoading) {
        updateIframeContent(currentIframeRef.current, iframeSrc, iframeSrcDoc);
      }
    }, [iframeSrc, iframeSrcDoc, isGenerating, isLoading, updateIframeContent]);

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

    // Show iframe container
    if (iframeSrc || iframeSrcDoc) {
      return (
        <ScrollArea className="grow [&>div>div]:!h-full">
          <div
            ref={containerRef}
            className="h-full w-full relative"
            style={{
              opacity: iframeReady ? 1 : 0,
              transition: 'opacity 200ms ease-in-out',
            }}
          />
        </ScrollArea>
      );
    }

    return null;
  }
);

PreviewFrameOptimized.displayName = 'PreviewFrameOptimized';

// Cleanup on module unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    iframePool.destroy();
  });
}

// Export a hook for manual iframe pool management
export function useIframePool() {
  return {
    acquire: () => iframePool.acquire(),
    release: (iframe: HTMLIFrameElement) => iframePool.release(iframe),
    destroy: () => iframePool.destroy(),
  };
}
