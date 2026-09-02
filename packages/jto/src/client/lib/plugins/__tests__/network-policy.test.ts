import { describe, expect, it } from 'vitest';
import {
  connectSrcValue,
  hasNetworkAccess,
  normalizeNetworkOrigin,
  parseNetworkOrigins,
} from '../network-policy';

const ok = (input: string) => {
  const result = normalizeNetworkOrigin(input);
  if (!result.ok)
    throw new Error(`expected "${input}" to parse: ${result.reason}`);
  return result.origin;
};
const rejected = (input: string) => {
  const result = normalizeNetworkOrigin(input);
  return result.ok ? null : result.reason;
};

describe('plugin network origins', () => {
  it('reads a bare host as https and keeps an explicit origin', () => {
    expect(ok('api.open-meteo.com')).toBe('https://api.open-meteo.com');
    expect(ok('https://api.open-meteo.com')).toBe('https://api.open-meteo.com');
    expect(ok('https://api.open-meteo.com/')).toBe(
      'https://api.open-meteo.com'
    );
    expect(ok('  https://api.open-meteo.com  ')).toBe(
      'https://api.open-meteo.com'
    );
  });

  it('keeps a port and a subdomain wildcard', () => {
    expect(ok('https://example.com:8443')).toBe('https://example.com:8443');
    expect(ok('*.open-meteo.com')).toBe('https://*.open-meteo.com');
  });

  it('allows http only for loopback', () => {
    expect(ok('http://localhost:3003')).toBe('http://localhost:3003');
    expect(ok('http://127.0.0.1:8080')).toBe('http://127.0.0.1:8080');
    expect(rejected('http://example.com')).toMatch(/https/);
  });

  it('refuses anything that would widen the policy back out', () => {
    expect(rejected('*')).toMatch(/wildcard/);
    expect(rejected('https:')).toMatch(/wildcard/);
    expect(rejected('*:*')).toMatch(/wildcard/);
  });

  it('refuses values that would break out of the directive', () => {
    // Each of these would end `connect-src` and start another directive, or
    // add a second source the author never wrote.
    for (const hostile of [
      'https://a.com; script-src *',
      'https://a.com https://evil.com',
      "https://a.com'",
      'https://a.com\nscript-src *',
    ]) {
      expect(normalizeNetworkOrigin(hostile).ok).toBe(false);
    }
  });

  it('refuses paths, credentials and non-http schemes', () => {
    expect(rejected('https://a.com/v1/forecast')).toMatch(/origin/);
    expect(rejected('https://user:pw@a.com')).toMatch(/credentials/);
    expect(rejected('data:text/plain,x')).toBeTruthy();
    expect(rejected('ws://a.com')).toBeTruthy();
    expect(rejected('')).toMatch(/empty/);
  });

  it('parses a field of several origins, reporting each bad line', () => {
    const parsed = parseNetworkOrigins(
      'api.open-meteo.com\ngeocoding-api.open-meteo.com\n*\nhttp://example.com'
    );
    expect(parsed.origins).toEqual([
      'https://api.open-meteo.com',
      'https://geocoding-api.open-meteo.com',
    ]);
    expect(parsed.errors).toHaveLength(2);
  });

  it('drops duplicates', () => {
    expect(parseNetworkOrigins('a.com, https://a.com, a.com/').origins).toEqual(
      ['https://a.com']
    );
  });

  it("builds 'none' unless the switch is on with a usable origin", () => {
    expect(connectSrcValue(false, ['https://a.com'])).toBe("'none'");
    expect(connectSrcValue(true, [])).toBe("'none'");
    expect(connectSrcValue(true, undefined)).toBe("'none'");
    expect(connectSrcValue(true, ['https://a.com', 'https://b.com'])).toBe(
      'https://a.com https://b.com'
    );
  });

  it('re-validates persisted origins instead of trusting them', () => {
    // A record written by an older build, or edited in IndexedDB by hand.
    expect(connectSrcValue(true, ['*'])).toBe("'none'");
    expect(connectSrcValue(true, ['https://a.com; default-src *'])).toBe(
      "'none'"
    );
    expect(connectSrcValue(true, ['*', 'https://a.com'])).toBe('https://a.com');
  });

  it('reports whether the plugin can reach anything', () => {
    expect(hasNetworkAccess(true, ['https://a.com'])).toBe(true);
    expect(hasNetworkAccess(true, [])).toBe(false);
    expect(hasNetworkAccess(false, ['https://a.com'])).toBe(false);
  });
});
