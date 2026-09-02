import { API_BASE_URL } from '../../config/api';

/**
 * Built-in themes for the running format, as the server's core defines them.
 *
 * Browser plugins receive the resolved theme at render time, and a document
 * that names `minimal` or `default` resolves to a theme the page does not
 * otherwise hold. Fetched once per session; a failed fetch is not cached so
 * the next expansion tries again.
 */
let cache: Record<string, unknown> | null = null;
let inFlight: Promise<Record<string, unknown>> | null = null;

export async function getBuiltinThemes(): Promise<Record<string, unknown>> {
  if (cache) return cache;
  if (!inFlight) {
    inFlight = (async () => {
      const response = await fetch(`${API_BASE_URL}/discovery/themes/builtin`);
      if (!response.ok) {
        throw new Error(`Built-in themes unavailable (${response.status})`);
      }
      const body = (await response.json()) as {
        success?: boolean;
        data?: Record<string, unknown>;
        error?: string;
      };
      if (!body.success || !body.data) {
        throw new Error(body.error ?? 'Built-in themes unavailable');
      }
      cache = body.data;
      return cache;
    })().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

/** The names alone, for callers that only need to know what exists. */
export async function getBuiltinThemeNames(): Promise<string[]> {
  try {
    return Object.keys(await getBuiltinThemes());
  } catch {
    return [];
  }
}
