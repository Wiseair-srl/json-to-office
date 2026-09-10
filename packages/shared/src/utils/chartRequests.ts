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
export function limitChartRequest<T>(
  serverUrl: string,
  concurrency: number | undefined,
  fn: () => Promise<T>
): Promise<T> {
  return gateFor(serverUrl, concurrency)(fn);
}

/**
 * Forget every gate. For tests, and for a host that reconfigures between
 * runs — never while requests are in flight, which would let the next caller
 * open a second pool alongside them.
 */
export function resetChartLimiters(): void {
  gates.clear();
}
