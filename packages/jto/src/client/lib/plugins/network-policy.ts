/**
 * Which origins a browser plugin may reach when its Network switch is on.
 *
 * `connect-src *` would make that switch mean "the whole internet", and the
 * same policy carries `'unsafe-eval'`: a plugin could then fetch code and run
 * it, so a source someone read and found harmless could pull its real payload
 * at render time, and anything it renders could be posted anywhere. Neither is
 * an escape from the sandbox — fetched code runs under the same opaque origin
 * and the same policy — but both defeat reading the plugin before trusting it.
 *
 * So the switch grants the origins listed against the plugin and nothing else.
 * Every value here ends up inside a CSP header, which is why parsing is strict
 * rather than forgiving: a stray `;` or space would end the directive and open
 * the rest of the policy.
 */

/** What a plugin with Network on but nothing listed is allowed to reach. */
const NOTHING = "'none'";

export type OriginResult =
  | { ok: true; origin: string }
  | { ok: false; reason: string };

/** Hostname, or `*.` plus one: letters, digits, hyphens and dots only. */
const HOST =
  /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

/** Loopback may be reached over plain http; everything else must be https. */
function isLoopback(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

/**
 * Turn one line of author input into a CSP source expression.
 *
 * `api.example.com` and `https://api.example.com` both mean the same origin;
 * a bare host is read as https because that is the only scheme worth
 * defaulting to. `*.example.com` matches subdomains, as CSP defines it.
 */
export function normalizeNetworkOrigin(input: string): OriginResult {
  const trimmed = input.trim().replace(/\/+$/, '');
  if (!trimmed) return { ok: false, reason: 'is empty' };
  // A blanket source would put the switch back to meaning "anywhere".
  if (trimmed === '*' || /^https?:$/i.test(trimmed) || trimmed === '*:*') {
    return { ok: false, reason: 'is a wildcard — name the hosts you need' };
  }

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  // `*.` is a CSP source expression, not a legal URL label: take it off before
  // parsing and put it back on the hostname afterwards.
  const wildcard = /^(https?:\/\/)\*\./i.test(withScheme);
  const parseable = wildcard
    ? withScheme.replace(/^(https?:\/\/)\*\./i, '$1')
    : withScheme;

  let url: URL;
  try {
    url = new URL(parseable);
  } catch {
    return { ok: false, reason: 'is not a URL' };
  }

  if (url.username || url.password) {
    return { ok: false, reason: 'must not carry credentials' };
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    return { ok: false, reason: 'must be an origin, with no path' };
  }

  const host = wildcard ? `*.${url.hostname}` : url.hostname;
  if (!HOST.test(host)) return { ok: false, reason: 'is not a hostname' };

  const protocol = url.protocol.toLowerCase();
  if (protocol !== 'https:' && protocol !== 'http:') {
    return { ok: false, reason: 'must be http or https' };
  }
  if (protocol === 'http:' && !isLoopback(url.hostname)) {
    return { ok: false, reason: 'must use https (http is only for localhost)' };
  }

  return {
    ok: true,
    origin: `${protocol}//${host}${url.port ? `:${url.port}` : ''}`,
  };
}

export interface ParsedOrigins {
  origins: string[];
  /** One per rejected line, ready to show against the field. */
  errors: string[];
}

/** Parse the field's text: one origin per line, or comma separated. */
export function parseNetworkOrigins(text: string): ParsedOrigins {
  const origins: string[] = [];
  const errors: string[] = [];
  for (const line of text.split(/[\n,]/)) {
    if (!line.trim()) continue;
    const result = normalizeNetworkOrigin(line);
    if (!result.ok) errors.push(`"${line.trim()}" ${result.reason}`);
    else if (!origins.includes(result.origin)) origins.push(result.origin);
  }
  return { origins, errors };
}

/**
 * The `connect-src` value for a plugin. Anything that did not survive
 * `normalizeNetworkOrigin` is dropped rather than trusted: this string is
 * interpolated into a policy, and a record could have been persisted by an
 * older build with looser rules.
 */
export function connectSrcValue(
  allowNetwork: boolean,
  origins: readonly string[] | undefined
): string {
  if (!allowNetwork || !origins?.length) return NOTHING;
  const safe = origins
    .map((origin) => normalizeNetworkOrigin(origin))
    .filter((result): result is { ok: true; origin: string } => result.ok)
    .map((result) => result.origin);
  return safe.length > 0 ? safe.join(' ') : NOTHING;
}

/** True when the plugin can reach anything at all — what the worker hardens on. */
export function hasNetworkAccess(
  allowNetwork: boolean,
  origins: readonly string[] | undefined
): boolean {
  return connectSrcValue(allowNetwork, origins) !== NOTHING;
}
