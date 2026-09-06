/**
 * Whether a service URL stays on this machine or a private network.
 *
 * The question the `highcharts` component has to answer before it posts a
 * chart — every series, label and title — to an export server. Only what an
 * address itself proves counts: loopback, RFC 1918, link-local and
 * unique-local literals, `localhost`, and the special-use names reserved for
 * private resolution (`.local`, `.internal`, `.home.arpa`). A hostname that
 * DNS decides — a bare label, a `.corp` — is not guessed at: it needs
 * `services.highcharts.allowRemote`, like any other.
 */
export function isPrivateServiceUrl(url: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(
      /^https?:\/\//i.test(url.trim()) ? url.trim() : `http://${url.trim()}`
    ).hostname.toLowerCase();
  } catch {
    return false;
  }
  const host = hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '::1' || /^f[cd][0-9a-f]{2}:/.test(host)) return true;
  if (/^fe[89ab][0-9a-f]:/.test(host)) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 127 ||
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }
  return /\.(local|internal|home\.arpa)$/.test(host);
}

/** Warning code for a chart posted outside the private network. */
export const REMOTE_EXPORT_WARNING = 'W_HIGHCHARTS_REMOTE_EXPORT';

/**
 * A public export server is a decision, not a default: the request carries
 * the whole chart, data included. Throws unless the caller opted in; when it
 * did, returns the sentence each pipeline records as a warning.
 */
export function remoteExportNotice(
  serverUrl: string,
  allowRemote: boolean | undefined
): string | undefined {
  if (isPrivateServiceUrl(serverUrl)) return undefined;
  if (!allowRemote) {
    throw new Error(
      `Highcharts export server ${serverUrl} is outside this machine and its private networks, ` +
        'and a chart is posted whole — every series, label and title. ' +
        'Run the export server locally (pnpm dlx highcharts-export-server --enableServer true), ' +
        'or set services.highcharts.allowRemote (HIGHCHARTS_ALLOW_REMOTE=1) to send chart data there deliberately.'
    );
  }
  return `Chart data — every series, label and title — was sent to ${serverUrl}, outside this machine and its private networks (services.highcharts.allowRemote).`;
}
