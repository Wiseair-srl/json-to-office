/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { sandboxDocument } from '../sandbox-frame';

const connectSrc = (html: string): string => {
  const match = html.match(/connect-src ([^;]*)/);
  if (!match) throw new Error('no connect-src in the policy');
  return match[1];
};

describe('sandbox frame policy', () => {
  it('reaches nothing until the switch is on with a host listed', () => {
    expect(connectSrc(sandboxDocument('n', false))).toBe("'none'");
    expect(connectSrc(sandboxDocument('n', false, ['https://a.com']))).toBe(
      "'none'"
    );
    expect(connectSrc(sandboxDocument('n', true, []))).toBe("'none'");
  });

  it("names the plugin's own hosts, never a blanket source", () => {
    const html = sandboxDocument('n', true, [
      'https://api.open-meteo.com',
      'https://geocoding-api.open-meteo.com',
    ]);
    expect(connectSrc(html)).toBe(
      'https://api.open-meteo.com https://geocoding-api.open-meteo.com'
    );
    expect(html).not.toContain('connect-src *');
  });

  it('cannot be widened by a hostile origin in the record', () => {
    // Every value is re-parsed on the way into the policy, so a record that
    // was hand-edited (or written by an older build) cannot add directives.
    const html = sandboxDocument('n', true, [
      'https://a.com; script-src *',
      '*',
      'https://ok.com',
    ]);
    expect(connectSrc(html)).toBe('https://ok.com');
    expect(html.match(/script-src/g)).toHaveLength(1);
  });

  it('keeps the rest of the policy locked down', () => {
    const html = sandboxDocument('nonce123', true, ['https://a.com']);
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("script-src 'nonce-nonce123' blob: 'unsafe-eval'");
    expect(html).toContain('worker-src blob:');
    expect(html).toContain("base-uri 'none'");
    expect(html).toContain("form-action 'none'");
  });
});
