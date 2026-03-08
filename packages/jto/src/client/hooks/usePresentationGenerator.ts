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

interface DocumentGenerationResponse {
  success: boolean;
  data: {
    document: string; // base64-encoded
    filename: string;
    fileId: string | null;
    contentType: string;
  };
  cache: {
    status: 'HIT' | 'MISS';
    hitRate: string;
  };
  warnings: GenerationWarning[];
  meta: {
    timestamp: string;
    requestId: string;
  };
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
      options?: { bypassCache?: boolean }
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
        onProgress?.('building', `Building ${FORMAT_LABEL.toLowerCase()} structure...`);
        const requestBody: {
          jsonDefinition: unknown;
          customThemes?: { [key: string]: unknown };
          options?: { bypassCache?: boolean };
        } = {
          jsonDefinition,
          options: options || {},
        };

        if (customThemes && Object.keys(customThemes).length > 0) {
          requestBody.customThemes = customThemes;
        }

        onProgress?.('rendering', `Generating ${FORMAT.toUpperCase()} content...`);
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

        // Parse JSON response
        const responseData: DocumentGenerationResponse = await response.json();

        if (!response.ok || !responseData.success) {
          const errorMessage =
            (responseData as unknown as { error?: string }).error ||
            `API request failed with status: ${response.status}`;
          throw new Error(errorMessage);
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
          throw new Error(`Received empty ${FORMAT_LABEL.toLowerCase()} from API`);
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
    cancelGeneration,
  };
}
