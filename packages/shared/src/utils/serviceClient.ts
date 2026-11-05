/**
 * Shared client for "service-rendered image" components (highcharts, visual).
 *
 * Both offload rendering to an injected HTTP service: resolve a base URL, POST a
 * JSON body with optional dynamic headers, and normalize transport errors — with
 * a request timeout so a wedged service can't hang the render forever, and a
 * bounded retry so one blip does not cost a whole document.
 *
 * The caller says how to read the body (`decode`: highcharts returns base64
 * text, visual returns JSON) rather than receiving the Response, because the
 * timeout has to cover the body too. A service that sends its headers and then
 * stalls the stream is the same outage as one that never answers, and a
 * Response handed back after the abort was disarmed would hang on the read.
 */

export type ServiceHeaders =
  | Record<string, string>
  | ((
      body: unknown
    ) => Record<string, string> | Promise<Record<string, string>>);

const DEFAULT_TIMEOUT_MS = 30000;
/**
 * Retries after the first attempt. Two is enough to ride out the restart of a
 * single-worker render service and short enough that a service which is
 * genuinely down still fails the document promptly.
 */
const DEFAULT_RETRIES = 2;
/** Backoff before the first retry; doubled each time, then jittered. */
const DEFAULT_RETRY_BASE_DELAY_MS = 250;
/** Ceiling on one backoff, so a long retry budget cannot stall a render. */
const MAX_RETRY_DELAY_MS = 2000;

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

export interface PostJsonOptions<T> {
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
  /** Attempts after the first for a retryable failure (default 2). */
  retries?: number;
  /** Backoff before the first retry, doubled each time (default 250ms). */
  retryBaseDelayMs?: number;
  /**
   * Called after each retryable failure, before the backoff. A body that
   * `accept` refused arrives here too, as an error whose `code` is
   * {@link RESPONSE_REJECTED_CODE}.
   */
  onRetry?: (attempt: number, error: Error) => void;
  /**
   * Judge a decoded 2xx body. `false` spends one attempt from the same
   * `retries` budget, with the same backoff, as a transport failure, and the
   * same body is posted again. A throw is not a refusal: it propagates at
   * once. Absent, every decoded body is accepted.
   */
  accept?: (body: T, attempt: number) => boolean | Promise<boolean>;
  /** Label used in the timeout message and the non-2xx error. */
  serviceLabel: string;
  /** Message builder for a connection failure (distinct from a timeout). */
  onUnreachable: (url: string, cause: string) => string;
  /** Read the 2xx body. Runs while the abort is still armed. */
  decode: (response: Response) => Promise<T>;
}

/**
 * A dependency that did not answer. The code lets a server route tell a
 * missing export server apart from a defect in the document or in itself,
 * and hand the caller the message that says how to start it.
 */
export const SERVICE_UNAVAILABLE_CODE = 'SERVICE_UNAVAILABLE';

/**
 * The `code` on the error `onRetry` receives when `accept` refused a body.
 * The service answered; the caller did not like what it said.
 */
export const RESPONSE_REJECTED_CODE = 'RESPONSE_REJECTED';

/** What the error messages need to know about a call. */
type ServiceNaming = Pick<
  PostJsonOptions<unknown>,
  'url' | 'serviceLabel' | 'onUnreachable'
>;

function responseRejected(opts: ServiceNaming): Error {
  return Object.assign(
    new Error(`${opts.serviceLabel} response was refused by the caller.`),
    { code: RESPONSE_REJECTED_CODE }
  );
}

function serviceUnavailable(message: string): Error {
  return Object.assign(new Error(message), { code: SERVICE_UNAVAILABLE_CODE });
}

/**
 * Is this worth trying again?
 *
 * A timeout or a connection failure says the service was busy or restarting,
 * and a 429 or 5xx says so in words. Every other 4xx is about the body we
 * sent — a malformed chart, an unknown field, a rejected credential — and
 * repeating it only makes the same answer arrive three times.
 */
function isRetryable(error: Error): boolean {
  const { code, status } = error as { code?: string; status?: number };
  if (code === SERVICE_UNAVAILABLE_CODE) return true;
  return status === 429 || (status !== undefined && status >= 500);
}

/**
 * The same failure, told with how many attempts it took. Callers match on the
 * message (see the COUPLING note in prerasterizeVisuals), so the original
 * sentence has to survive intact — and the `code` with it.
 */
function withAttemptCount(error: Error, attempts: number): Error {
  const next = new Error(`${error.message} (after ${attempts} attempts)`);
  const { code, status } = error as { code?: string; status?: number };
  if (code !== undefined) Object.assign(next, { code });
  if (status !== undefined) Object.assign(next, { status });
  return next;
}

/**
 * Exponential backoff with jitter. The jitter matters more than the curve
 * here: a document's charts fail together, so retrying them all on the same
 * schedule would re-create the burst the concurrency gate exists to prevent.
 */
function backoffMs(attempt: number, baseDelayMs: number): number {
  const ceiling = Math.min(
    baseDelayMs * 2 ** (attempt - 1),
    MAX_RETRY_DELAY_MS
  );
  return Math.round(ceiling * (0.5 + Math.random() * 0.5));
}

/**
 * A service that did not answer, whether it refused the connection, timed out,
 * or broke off mid-body. One shape for all three, because the caller's choice
 * — fall back, retry, report the outage — is the same for all three.
 */
function transportFailure(
  error: unknown,
  opts: ServiceNaming,
  timeoutMs: number
): Error {
  if ((error as Error)?.name === 'AbortError') {
    return serviceUnavailable(
      `${opts.serviceLabel} timed out after ${timeoutMs}ms at ${opts.url}.`
    );
  }
  const cause = error instanceof Error ? error.message : String(error);
  return serviceUnavailable(opts.onUnreachable(opts.url, cause));
}

/** One request/response exchange, from connection to decoded body. */
async function exchange<T>(
  opts: PostJsonOptions<T>,
  headers: Record<string, string>,
  signal: AbortSignal,
  timeoutMs: number
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${opts.url}${opts.path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(opts.body),
      signal,
    });
  } catch (error) {
    throw transportFailure(error, opts, timeoutMs);
  }

  if (!response.ok) {
    // Nothing here will read a failed body, and an undrained one holds its
    // connection open — which a document's worth of failures would exhaust.
    await response.body?.cancel().catch(() => undefined);
    // `status` is what the retry decision reads; the message stays the one
    // every existing caller matches on.
    throw Object.assign(
      new Error(
        `${opts.serviceLabel} returned ${response.status}: ${response.statusText}`
      ),
      { status: response.status }
    );
  }

  try {
    return await opts.decode(response);
  } catch (error) {
    throw transportFailure(error, opts, timeoutMs);
  }
}

async function attemptPost<T>(
  opts: PostJsonOptions<T>,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await exchange(opts, headers, controller.signal, timeoutMs);
  } finally {
    // Only once the body has been read: disarming at the headers would leave
    // a stalled stream with nothing to interrupt it.
    clearTimeout(timer);
  }
}

/**
 * What {@link postJsonToServiceWithOutcome} ended with: the body, whether
 * `accept` took it, and how many posts it cost.
 */
export interface ServiceOutcome<T> {
  /** The accepted body, or the last one `accept` refused. */
  body: T;
  /** `false` only when `accept` refused every body the service returned. */
  accepted: boolean;
  /** Posts made, the first included. */
  attempts: number;
}

/**
 * POST a JSON body to `${url}${path}` and return the decoded 2xx body, under
 * one timeout covering the whole exchange and retrying a service that was
 * busy or restarting. Throws a normalized Error on timeout, connection
 * failure, a body that broke off, or a non-2xx.
 */
export async function postJsonToService<T>(
  opts: PostJsonOptions<T>
): Promise<T> {
  return (await postJsonToServiceWithOutcome(opts)).body;
}

/**
 * {@link postJsonToService}, saying whether `accept` took the body.
 *
 * A refused body is retried like a transport failure. Once the budget is
 * spent, the last refused body is returned with `accepted: false` rather than
 * thrown: the service did answer, and whether a refused answer is good
 * enough is the caller's call. The same holds when a refusal is followed by a
 * failure — a service that has already returned a body never ends the call
 * worse off than it would have without `accept`.
 */
export async function postJsonToServiceWithOutcome<T>(
  opts: PostJsonOptions<T>
): Promise<ServiceOutcome<T>> {
  const resolvedHeaders =
    typeof opts.headers === 'function'
      ? await opts.headers(opts.body)
      : opts.headers;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...resolvedHeaders,
  };

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const baseDelayMs = opts.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
  const attempts = 1 + Math.max(0, opts.retries ?? DEFAULT_RETRIES);
  const backoff = (attempt: number): Promise<void> =>
    new Promise((resolve) =>
      setTimeout(resolve, backoffMs(attempt, baseDelayMs))
    );

  // The last body `accept` refused, kept in case nothing better comes.
  let refused: { body: T } | undefined;

  for (let attempt = 1; ; attempt++) {
    let body: T;
    try {
      body = await attemptPost(opts, headers, timeoutMs);
    } catch (error) {
      const failure = error as Error;
      if (attempt >= attempts || !isRetryable(failure)) {
        if (refused) {
          return { body: refused.body, accepted: false, attempts: attempt };
        }
        // A first-attempt failure is reported exactly as it always was: a
        // malformed chart should read the same whether or not retries exist.
        throw attempt === 1 ? failure : withAttemptCount(failure, attempt);
      }
      opts.onRetry?.(attempt, failure);
      await backoff(attempt);
      continue;
    }

    // Outside the try: a throwing `accept` is the caller's defect, not the
    // service's, and must not be retried or reworded as an outage.
    if (!opts.accept || (await opts.accept(body, attempt))) {
      return { body, accepted: true, attempts: attempt };
    }
    if (attempt >= attempts) {
      return { body, accepted: false, attempts: attempt };
    }
    refused = { body };
    opts.onRetry?.(attempt, responseRejected(opts));
    await backoff(attempt);
  }
}
