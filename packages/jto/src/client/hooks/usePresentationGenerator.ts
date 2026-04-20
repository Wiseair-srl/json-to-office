import { useCallback, useRef } from 'react';
import { FORMAT, FORMAT_LABEL } from '../lib/env';
import { API_ENDPOINTS } from '../config/api';
import {
  getAllAsPayload as getAllUserFontsAsPayload,
  type UserFontPayload,
} from '../lib/user-fonts-storage';

export interface GenerationWarning {
  component: string;
  message: string;
  severity?: 'warning' | 'info';
  context?: Record<string, unknown>;
}

export interface EmbeddedFontVariant {
  family: string;
  weight: number;
  italic: boolean;
  format: 'ttf' | 'otf' | 'woff' | 'woff2' | 'eot' | 'unknown';
  /** Base64-encoded font bytes — used to build @font-face rules in previews. */
  data: string;
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
  /** Fonts embedded in the generated file, available for in-browser preview. */
  fonts?: EmbeddedFontVariant[];
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
        onProgress?.(
          'building',
          `Building ${FORMAT_LABEL.toLowerCase()} structure...`
        );
        const requestBody: {
          jsonDefinition: unknown;
          customThemes?: { [key: string]: unknown };
          userFonts?: UserFontPayload[];
          options?: { bypassCache?: boolean };
        } = {
          jsonDefinition,
          options: options || {},
        };

        requestBody.customThemes = customThemes ?? {};

        // Attach any browser-local uploaded fonts. The server only consumes
        // those actually referenced by the doc/themes, so sending the full
        // set is harmless — skipping the filter keeps the client simple.
        try {
          const userFonts = await getAllUserFontsAsPayload();
          if (userFonts.length > 0) requestBody.userFonts = userFonts;
        } catch (err) {
          // IDB read failing should not block generation; log and continue.
          console.warn('Could not load uploaded fonts from IndexedDB:', err);
        }

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

        // Parse JSON response
        const responseData = await response.json();

        if (!response.ok || !responseData.success) {
          const errorMessage =
            responseData.error ||
            responseData.message ||
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
          fonts: Array.isArray(data.fonts) ? data.fonts : undefined,
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
