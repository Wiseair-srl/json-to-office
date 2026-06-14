/**
 * Shared client for "service-rendered image" components (highcharts, visual).
 *
 * Both offload rendering to an injected HTTP service: resolve a base URL, POST a
 * JSON body with optional dynamic headers, and normalize transport errors — now
 * with a request timeout so a wedged service can't hang the render forever.
 * Callers decode the response body themselves (highcharts returns base64 text,
 * visual returns JSON), so this returns the raw Response on success.
 */

export type ServiceHeaders =
  | Record<string, string>
  | ((
      body: unknown
    ) => Record<string, string> | Promise<Record<string, string>>);

const DEFAULT_TIMEOUT_MS = 30000;

/**
 * Resolve a service base URL: per-call override → services config → default.
 * Adds an `http://` scheme to a bare host and strips trailing slashes so callers
 * can append `${url}/path` without producing a `//path` that breaks routers.
 */
export function resolveServiceUrl(
  propsUrl: string | undefined,
  servicesUrl: string | undefined,
  defaultUrl: string
): string {
  const raw = (propsUrl || servicesUrl || defaultUrl).trim();
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  return withScheme.replace(/\/+$/, '');
}

export interface PostJsonOptions {
  /** Resolved base URL (use resolveServiceUrl). */
  url: string;
  /** Path appended to the base URL, e.g. '/export' or '/rasterize'. */
  path: string;
  /** Request body (JSON-serialized). */
  body: unknown;
  /** Static headers or an async resolver receiving the body. */
  headers?: ServiceHeaders;
  /** Abort timeout in ms (default 30s). */
  timeoutMs?: number;
  /** Label used in the timeout message and the non-2xx error. */
  serviceLabel: string;
  /** Message builder for a connection failure (distinct from a timeout). */
  onUnreachable: (url: string, cause: string) => string;
}

/**
 * POST a JSON body to `${url}${path}` with a timeout. Returns the Response on a
 * 2xx; throws a normalized Error on timeout, connection failure, or non-2xx.
 */
export async function postJsonToService(
  opts: PostJsonOptions
): Promise<Response> {
  const resolvedHeaders =
    typeof opts.headers === 'function'
      ? await opts.headers(opts.body)
      : opts.headers;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...resolvedHeaders,
  };

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${opts.url}${opts.path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(opts.body),
      signal: controller.signal,
    });
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') {
      throw new Error(
        `${opts.serviceLabel} timed out after ${timeoutMs}ms at ${opts.url}.`
      );
    }
    const cause = error instanceof Error ? error.message : String(error);
    throw new Error(opts.onUnreachable(opts.url, cause));
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(
      `${opts.serviceLabel} returned ${response.status}: ${response.statusText}`
    );
  }
  return response;
}
