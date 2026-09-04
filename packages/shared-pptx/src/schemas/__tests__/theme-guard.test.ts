/**
 * `isValidThemeConfig` has to actually check something.
 *
 * It was `typeof data === 'object' && data !== null` — a type-asserting no-op
 * that answered `true` for `{}`, then handed the caller a `ThemeConfigJson`
 * the compiler trusted. Anything reaching for it as a guard got no validation
 * at all, and a malformed theme surfaced much later as a TypeError inside the
 * IR compiler rather than as a diagnostic naming the bad field.
 *
 * The DOCX twin has always been `Value.Check(ThemeConfigSchema, data)`; this
 * pins the two to the same contract.
 */

import { describe, expect, it } from 'vitest';
import { isValidThemeConfig } from '../theme';

const VALID = {
  name: 'probe',
  colors: {
    primary: '#4472C4',
    secondary: '#5B9BD5',
    accent: '#ED7D31',
    background: '#FFFFFF',
    text: '#000000',
  },
  fonts: { heading: 'Arial', body: 'Arial' },
  defaults: { fontSize: 18, fontColor: '#000000' },
};

describe('isValidThemeConfig', () => {
  it('accepts a complete theme', () => {
    expect(isValidThemeConfig(VALID)).toBe(true);
  });

  it('rejects an empty object, which it used to accept', () => {
    expect(isValidThemeConfig({})).toBe(false);
  });

  it('rejects a theme missing a required section', () => {
    const withoutDefaults = { ...VALID };
    delete (withoutDefaults as Partial<typeof VALID>).defaults;
    expect(isValidThemeConfig(withoutDefaults)).toBe(false);
  });

  it('rejects a colour the palette pattern does not accept', () => {
    // pptx colours are strict hex — a token reference is not a colour here.
    expect(
      isValidThemeConfig({
        ...VALID,
        colors: { ...VALID.colors, primary: 'not-a-colour' },
      })
    ).toBe(false);
  });

  it('rejects a key the theme does not declare', () => {
    expect(isValidThemeConfig({ ...VALID, nonsense: true })).toBe(false);
  });

  it('rejects the non-objects it was already rejecting', () => {
    for (const value of [null, undefined, 'theme', 42, []]) {
      expect(isValidThemeConfig(value), String(value)).toBe(false);
    }
  });
});
