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
