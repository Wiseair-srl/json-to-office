/**
 * Hostname allowlist for font fetchers.
 *
 * `url-fetcher` and `variable-fetcher` can be handed arbitrary URLs via
 * `FontRegistryEntry.sources`, which may originate from document JSON. Without
 * a guard, a malicious doc could point fetchers at internal hosts (SSRF), the
 * filesystem (`file://`), or the IMDS endpoint. Limit downloads to the hosts
 * our catalog + UPSTREAM_OVERRIDES actually target.
 *
 * Keep the list small and HTTPS-only. Expansions should be deliberate code
 * reviews, not config-driven — the cost of a new domain is the code change.
 */

export const FONT_URL_ALLOWLIST: readonly string[] = [
  'fonts.gstatic.com',
  'fonts.googleapis.com',
  'cdn.jsdelivr.net',
];

export function isAllowedFontUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  return FONT_URL_ALLOWLIST.includes(parsed.hostname.toLowerCase());
}
