import { useCallback, useRef } from 'react';
import { FORMAT, FORMAT_LABEL } from '../lib/env';
import { API_ENDPOINTS } from '../config/api';

export interface GenerationWarning {
  component: string;
  message: string;
  severity?: 'warning' | 'info';
  context?: Record<string, unknown>;
}

export interface DocumentGenerationResult {
  name: string;
  text: string;
  blob: Blob;
  filename: string;
  fileId: string | null;
  cacheStatus: 'HIT' | 'MISS' | 'UNKNOWN';
  cacheHitRate: string;
  warnings: GenerationWarning[];
}

/** The JSON body, or undefined when the response is not JSON at all. */
async function readJsonBody(response: Response): Promise<any | undefined> {
  if (!response.headers.get('content-type')?.includes('application/json')) {
    return undefined;
  }
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

/**
 * Turn a failed generation into a sentence that says what to do next.
 *
 * The API's own error text is always the best answer. When there is none the
 * response came from the platform rather than the app, and the status is the
 * only signal there is — so name the likely cause rather than echoing a raw
 * status code.
 */
function describeFailure(
  response: Response,
  body: { error?: string; message?: string } | undefined
): string {
  if (body?.error) return body.error;
  if (body?.message) return body.message;

  switch (response.status) {
    case 502:
    case 503:
    case 504:
      return (
        `The server did not finish generating (${response.status}). It usually ` +
        'ran out of memory or restarted mid-request — documents with many ' +
        'full-page images or inline SVGs are the common cause. Try again, or ' +
        'split the document and generate it in parts.'
      );
    case 413:
      return 'The document is too large for the server to accept (413). Remove or shrink its largest embedded assets.';
    case 429:
      return 'Too many requests (429). Wait a moment before generating again.';
    default:
      return `Generation failed (${response.status}${
        response.statusText ? ` ${response.statusText}` : ''
      }).`;
  }
}

export function usePresentationGenerator() {
  const abortControllerRef = useRef<AbortController | null>(null);

  const generatePresentation = useCallback(
    async (
      name: string,
      text: string,
      customThemes?: { [key: string]: unknown },
      onProgress?: (
        stage: 'parsing' | 'building' | 'rendering' | 'finalizing',
        message?: string
      ) => void,
      options?: {
        bypassCache?: boolean;
        fonts?: {
          mode?: 'substitute' | 'custom';
          substitution?: Record<string, string>;
        };
      }
    ): Promise<DocumentGenerationResult> => {
      // Cancel any previous generation
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      try {
        // Parse JSON content
        onProgress?.('parsing', 'Validating JSON structure...');
        let jsonDefinition;
        try {
          jsonDefinition = JSON.parse(text);
        } catch (parseError) {
          throw new Error(
            `Invalid JSON: ${parseError instanceof Error ? parseError.message : 'Unknown parse error'}`
          );
        }

        // Make API call to generate presentation
        onProgress?.(
          'building',
          `Building ${FORMAT_LABEL.toLowerCase()} structure...`
        );
        const requestBody: {
          jsonDefinition: unknown;
          customThemes?: { [key: string]: unknown };
          options?: {
            bypassCache?: boolean;
            sourceName?: string;
            fonts?: {
              mode?: 'substitute' | 'custom';
              substitution?: Record<string, string>;
              strict?: boolean;
            };
          };
        } = {
          jsonDefinition,
          // sourceName lets the server resolve relative asset paths against
          // the discovered document's own directory (#142).
          options: { ...options, sourceName: name },
        };

        requestBody.customThemes = customThemes ?? {};

        onProgress?.(
          'rendering',
          `Generating ${FORMAT.toUpperCase()} content...`
        );
        const headers: HeadersInit = {
          'Content-Type': 'application/json',
        };

        if (options?.bypassCache) {
          headers['X-Bypass-Cache'] = 'true';
        }

        const response = await fetch(API_ENDPOINTS.generate, {
          method: 'POST',
          headers,
          body: JSON.stringify(requestBody),
          signal: abortController.signal,
        });

        // The body is only JSON when the API itself answered. A proxy that
        // never reached the API — or reached one that died mid-request —
        // answers with its own HTML error page, and parsing that unguarded is
        // what produced `Unexpected token '<', "<!DOCTYPE "...` instead of
        // anything an author could act on.
        const responseData = await readJsonBody(response);

        if (!response.ok || !responseData?.success) {
          throw new Error(describeFailure(response, responseData));
        }

        // Extract data from structured response
        const { data, cache, warnings } = responseData;
        const cacheStatus: 'HIT' | 'MISS' | 'UNKNOWN' =
          cache.status === 'HIT'
            ? 'HIT'
            : cache.status === 'MISS'
              ? 'MISS'
              : 'UNKNOWN';

        // Show cache status in progress
        const cacheMessage =
          cacheStatus === 'HIT'
            ? `Served from cache (Hit rate: ${cache.hitRate})`
            : `Generated fresh ${FORMAT_LABEL.toLowerCase()}`;
        onProgress?.('finalizing', cacheMessage);

        // Convert base64 to Blob
        const binaryString = globalThis.atob(data.document);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: data.contentType });

        if (blob.size === 0) {
          throw new Error(
            `Received empty ${FORMAT_LABEL.toLowerCase()} from API`
          );
        }

        return {
          name,
          text,
          blob,
          filename: data.filename,
          fileId: data.fileId,
          cacheStatus,
          cacheHitRate: cache.hitRate,
          warnings,
        };
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          throw new Error(`${FORMAT_LABEL} generation was cancelled`);
        }
        throw error;
      } finally {
        if (abortControllerRef.current === abortController) {
          abortControllerRef.current = null;
        }
      }
    },
    []
  );

  const cancelGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  return {
    generatePresentation,
    // Format-agnostic alias: the hook dispatches to API_ENDPOINTS.generate
    // for both DOCX and PPTX, so callers on either side should prefer
    // `generateDocument` for clarity.
    generateDocument: generatePresentation,
    cancelGeneration,
  };
}
