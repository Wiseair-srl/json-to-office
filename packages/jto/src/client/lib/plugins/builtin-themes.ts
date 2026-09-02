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

/** A stalled server must not hold a build open indefinitely. */
const FETCH_TIMEOUT_MS = 10_000;

/** Reject as soon as `signal` aborts, leaving `promise` to its own fate. */
function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort);
    });
  });
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('Aborted', 'AbortError');
}

export async function getBuiltinThemes(
  signal?: AbortSignal
): Promise<Record<string, unknown>> {
  if (cache) return cache;
  if (!inFlight) {
    inFlight = (async () => {
      const response = await fetch(`${API_BASE_URL}/discovery/themes/builtin`, {
        // The shared request carries only its own deadline: one caller walking
        // away must not abort the fetch every other caller is awaiting.
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
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
  // A cancelled caller stops waiting here; the request itself carries on for
  // whoever else is queued behind it.
  return signal ? withAbort(inFlight, signal) : inFlight;
}

/** The names alone, for callers that only need to know what exists. */
export async function getBuiltinThemeNames(): Promise<string[]> {
  try {
    return Object.keys(await getBuiltinThemes());
  } catch {
    return [];
  }
}
