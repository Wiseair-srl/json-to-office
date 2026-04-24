import { describe, it, expect } from 'vitest';
import { isAllowedFontUrl, FONT_URL_ALLOWLIST } from '../url-allowlist';

describe('isAllowedFontUrl', () => {
  it('allows https hosts in the allowlist', () => {
    expect(
      isAllowedFontUrl('https://fonts.gstatic.com/s/inter/v12/x.ttf')
    ).toBe(true);
    expect(
      isAllowedFontUrl('https://fonts.googleapis.com/css2?family=Inter')
    ).toBe(true);
    expect(
      isAllowedFontUrl(
        'https://cdn.jsdelivr.net/npm/@fontsource/inter@5.0.0/files/inter-latin-400-normal.woff2'
      )
    ).toBe(true);
  });

  it('rejects http URLs even for allowlisted hosts', () => {
    expect(isAllowedFontUrl('http://fonts.gstatic.com/s/inter/v12/x.ttf')).toBe(
      false
    );
  });

  it('rejects hosts not in the allowlist', () => {
    expect(isAllowedFontUrl('https://evil.example.com/font.ttf')).toBe(false);
    expect(isAllowedFontUrl('https://gstatic.com.evil.example/x.ttf')).toBe(
      false
    );
  });

  it('rejects file:// and other non-http schemes', () => {
    expect(isAllowedFontUrl('file:///etc/passwd')).toBe(false);
    expect(isAllowedFontUrl('ftp://fonts.gstatic.com/x.ttf')).toBe(false);
    expect(isAllowedFontUrl('javascript:alert(1)')).toBe(false);
  });

  it('rejects malformed URLs', () => {
    expect(isAllowedFontUrl('not-a-url')).toBe(false);
    expect(isAllowedFontUrl('')).toBe(false);
    expect(isAllowedFontUrl('https://')).toBe(false);
  });

  it('rejects localhost / private IPs via hostname mismatch', () => {
    expect(isAllowedFontUrl('https://localhost/x.ttf')).toBe(false);
    expect(isAllowedFontUrl('https://127.0.0.1/x.ttf')).toBe(false);
    expect(isAllowedFontUrl('https://169.254.169.254/latest/meta-data/')).toBe(
      false
    );
  });

  it('matches hostname case-insensitively', () => {
    expect(isAllowedFontUrl('https://FONTS.GSTATIC.COM/x.ttf')).toBe(true);
  });

  it('exports the allowlist as a readonly snapshot', () => {
    expect(FONT_URL_ALLOWLIST).toContain('fonts.gstatic.com');
    expect(FONT_URL_ALLOWLIST).toContain('cdn.jsdelivr.net');
  });
});
