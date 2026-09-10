/**
 * The gate every chart export request passes through.
 *
 * A document's charts are desugared by a walk that resolves arrays with
 * `Promise.all`, so without a gate a fifty-chart document opens fifty
 * simultaneous connections to an export server that renders with a single
 * Puppeteer worker. That is how one slow chart becomes a whole document
 * timing out: the server queues forty-nine requests behind the first and
 * every one of them is already counting down its own abort.
 *
 * The gate is module-scoped and keyed by resolved server URL rather than
 * created per document on purpose. A host that renders several documents at
 * once in one process — a server does; a Lambda handling one request does
 * not — would otherwise get a full pool per document and burst straight past
 * the cap. Two different URLs are two independent pools, since the cap exists
 * to protect one server's workers, not to ration the client.
 */

import { createLimiter } from './promiseLimiter';

/**
 * Concurrent chart requests allowed per export server. Four keeps a
 * single-worker server busy without letting a document's charts queue so deep
 * that the ones at the back abort before they are ever picked up.
 */
export const DEFAULT_CHART_CONCURRENCY = 4;

type Limit = <T>(fn: () => Promise<T>) => Promise<T>;

/**
 * Cumulative chart-work counters, on the model of `getVisualPrepassStats()`.
 *
 * A saturated export server should be legible before it starts failing:
 * `maxInFlight` at the cap for a whole run says the queue is the bottleneck,
 * and `retries` climbing says the server is shedding work rather than
 * refusing it. `collected - unique` is what deduplication saved.
 */
export interface ChartRequestStats {
  /** Charts that entered the gate. */
  collected: number;
  /** Requests that actually reached an export server, after dedupe. */
  unique: number;
  /** Retries spent across those requests. */
  retries: number;
  /** Most requests observed open against an export server at one time. */
  maxInFlight: number;
}

const stats: ChartRequestStats = {
  collected: 0,
  unique: 0,
  retries: 0,
  maxInFlight: 0,
};

let inFlight = 0;

export function getChartRequestStats(): ChartRequestStats {
  return { ...stats };
}

export function resetChartRequestStats(): void {
  stats.collected = 0;
  stats.unique = 0;
  stats.retries = 0;
  stats.maxInFlight = 0;
}

/**
 * Record one chart the document asked for, before anything is deduped or
 * queued. Counted at the walk rather than inside {@link sendChartRequest} so
 * `collected - unique` stays the work deduplication saved.
 */
export function recordChartCollected(): void {
  stats.collected++;
}

/** Record one retry. Wire it to `postJsonToService`'s `onRetry`. */
export function recordChartRetry(): void {
  stats.retries++;
}

const gates = new Map<string, Limit>();

function gateFor(serverUrl: string, concurrency: number | undefined): Limit {
  const existing = gates.get(serverUrl);
  if (existing) return existing;
  const max = Math.max(
    1,
    Math.floor(
      Number.isFinite(concurrency as number)
        ? (concurrency as number)
        : DEFAULT_CHART_CONCURRENCY
    )
  );
  const gate = createLimiter(max);
  gates.set(serverUrl, gate);
  return gate;
}

/**
 * Run `fn` — one chart's trip to `serverUrl` — under that server's cap.
 *
 * The first caller to reach a URL fixes its cap for the life of the process:
 * the pool belongs to the server, so a second document cannot widen it by
 * asking for more. A host that wants a different cap sets the same one
 * everywhere, or calls {@link resetChartLimiters} between runs.
 */
function limitChartRequest<T>(
  serverUrl: string,
  concurrency: number | undefined,
  fn: () => Promise<T>
): Promise<T> {
  return gateFor(serverUrl, concurrency)(fn);
}

/**
 * Identity of one chart export request: the server it goes to and the body it
 * carries.
 *
 * The body itself rather than a digest of it. Hashing would pull a Node
 * builtin into a module the browser bundle includes, and the map this keys is
 * per document and holds one entry per *unique* chart — so it costs about
 * what the requests it saves already cost, and it cannot collide.
 */
function chartRequestKey(serverUrl: string, requestBody: unknown): string {
  return `${serverUrl}\n${JSON.stringify(requestBody)}`;
}

/** Per-document memo of chart renders, keyed by {@link chartRequestKey}. */
export type ChartRenderCache<T> = Map<string, Promise<T>>;

/**
 * Render a chart once per document however many times it appears.
 *
 * The *promise* is memoized, not the result, so charts that are identical and
 * concurrent — the normal case, since a document's charts are desugared
 * together — share one request rather than racing to start several. A failed
 * render is shared too: the same body would fail the same way, and letting
 * fifty copies each spend the retry budget is exactly the storm the gate
 * exists to prevent.
 */
function dedupeChartRequest<T>(
  cache: ChartRenderCache<T> | undefined,
  key: string,
  send: () => Promise<T>
): Promise<T> {
  if (!cache) return send();
  const pending = cache.get(key);
  if (pending) return pending;
  const started = send();
  cache.set(key, started);
  return started;
}

/** One chart's trip to an export server. */
export interface ChartRequest<T> {
  /** Per-document memo; omit to render every appearance separately. */
  cache: ChartRenderCache<T> | undefined;
  /** Resolved export server URL: keys both the memo and the gate. */
  serverUrl: string;
  /** Cap for that server (default {@link DEFAULT_CHART_CONCURRENCY}). */
  concurrency: number | undefined;
  /** The body about to be posted; its identity is the memo key. */
  requestBody: unknown;
  /** Post it. */
  send: () => Promise<T>;
}

/**
 * Memo, then gate, then counter — and the order is the whole point.
 *
 * A chart that the document has already rendered has no request to make, so
 * it must not sit in the gate holding a slot that a chart with real work to
 * do could use: four copies of one figure would otherwise fill the default
 * pool while a single request was in flight. And only what reaches the wire
 * is counted in flight, so `maxInFlight` means requests open against the
 * server rather than charts waiting their turn.
 */
export function sendChartRequest<T>(request: ChartRequest<T>): Promise<T> {
  return dedupeChartRequest(
    request.cache,
    chartRequestKey(request.serverUrl, request.requestBody),
    () =>
      limitChartRequest(request.serverUrl, request.concurrency, () =>
        counted(request.send)
      )
  );
}

/** One real trip to an export server, counted while it is open. */
async function counted<T>(send: () => Promise<T>): Promise<T> {
  stats.unique++;
  inFlight++;
  stats.maxInFlight = Math.max(stats.maxInFlight, inFlight);
  try {
    return await send();
  } finally {
    inFlight--;
  }
}

/**
 * Forget every gate. For tests, and for a host that reconfigures between
 * runs — never while requests are in flight, which would let the next caller
 * open a second pool alongside them.
 */
export function resetChartLimiters(): void {
  gates.clear();
}
