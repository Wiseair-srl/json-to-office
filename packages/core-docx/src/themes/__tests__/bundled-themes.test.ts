/**
 * Regression: every bundled theme JSON must satisfy the theme schema.
 * Themes shipped with dead `componentDefaults.table` props (borders,
 * borderWidth, headerBackground, headerColor, striped) that no renderer read
 * and that the validator rejects. Guards against re-adding them.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { validateThemeJson, formatValidationErrors } from '../json/validator';
import { createMinimalTheme } from '../json';
import { getTheme, getThemeNames } from '../../templates/themes';
import {
  BUILT_IN_DOCX_THEME_NAMES,
  ReportPropsSchema,
} from '@json-to-office/shared-docx';

const themesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../templates/themes'
);

const themeFiles = fs
  .readdirSync(themesDir)
  .filter((file) => file.endsWith('.docx.theme.json'))
  .sort();

describe('bundled docx themes', () => {
  it('finds the bundled theme files', () => {
    expect(themeFiles.length).toBeGreaterThan(0);
  });

  it.each(themeFiles)('%s validates against the theme schema', (file) => {
    const result = validateThemeJson(
      fs.readFileSync(path.join(themesDir, file), 'utf8')
    );

    const errors = result.success ? [] : formatValidationErrors(result.error!);
    expect(errors).toEqual([]);
    expect(result.success).toBe(true);
  });
});

/**
 * The files above are one thing; what `getTheme()` hands the renderer is
 * another. Built-ins are loaded with a raw JSON import cast to
 * `ThemeConfigJson` and then backfilled by `ensureThemeDefaults`, so neither
 * `tsc` nor the parser ever sees them. This walks the registry itself.
 */
describe('built-in theme registry', () => {
  const registeredNames = getThemeNames();

  it('registers the statically imported themes', () => {
    expect(registeredNames).toEqual(
      expect.arrayContaining([...BUILT_IN_DOCX_THEME_NAMES])
    );
  });

  /**
   * The editor completes `"theme": ""` from these `examples`, so a theme that
   * reaches the registry without reaching the list is one the renderer accepts
   * and the editor never suggests. That is exactly what happened on the pptx
   * side, where the two lists were maintained by hand and drifted.
   */
  it('offers every registered theme for completion', () => {
    const theme = (ReportPropsSchema as any).properties.theme;
    expect([...theme.examples].sort()).toEqual(
      [...BUILT_IN_DOCX_THEME_NAMES].sort()
    );
    for (const name of BUILT_IN_DOCX_THEME_NAMES) {
      expect(registeredNames).toContain(name);
      expect(theme.description).toContain(name);
    }
  });

  it.each(registeredNames)('getTheme(%s) returns a valid theme', (name) => {
    const result = validateThemeJson(JSON.stringify(getTheme(name)));

    const errors = result.success ? [] : formatValidationErrors(result.error!);
    expect(errors).toEqual([]);
  });
});

describe('createMinimalTheme', () => {
  it('scaffolds a theme that is valid on creation', () => {
    const result = validateThemeJson(JSON.stringify(createMinimalTheme()));

    const errors = result.success ? [] : formatValidationErrors(result.error!);
    expect(errors).toEqual([]);
  });

  it('carries the requested name through to name and displayName', () => {
    const theme = createMinimalTheme('house-style');

    expect(theme.name).toBe('house-style');
    expect(theme.displayName).toBe('House Style');
    expect(validateThemeJson(JSON.stringify(theme)).success).toBe(true);
  });
});
