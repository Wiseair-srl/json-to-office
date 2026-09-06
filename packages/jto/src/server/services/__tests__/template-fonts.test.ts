import { prepareDocxQualityDocument } from '@json-to-office/core-docx';
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  collectFontNamesFromDocx,
  collectFontNamesFromPptx,
  isSafeFont,
  POPULAR_GOOGLE_FONTS,
} from '@json-to-office/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = path.resolve(
  __dirname,
  '../../../client/public/templates'
);

const CATALOG = new Set(
  POPULAR_GOOGLE_FONTS.map((f) => f.family.toLowerCase())
);

/**
 * "Inter Medium", "Geist Light", "Space Grotesk Medium" — the strings
 * synthesizeFamilyName() PRODUCES from family + fontWeight. Authored as input
 * they resolve to nothing: no catalog match, no staged bytes, one
 * FONT_UNRESOLVED per reference. 417 of them shipped in the stock templates
 * because FontFamilyNameSchema is a free-form string. This is the assertion
 * that would have caught all of them.
 */
const templateFiles = fs
  .readdirSync(TEMPLATE_DIR)
  .filter((f) => f.endsWith('.docx.json') || f.endsWith('.pptx.json'))
  .sort();

describe('bundled playground templates', () => {
  it('ships at least the known stock templates', () => {
    expect(templateFiles.length).toBeGreaterThanOrEqual(8);
  });

  it.each(templateFiles)(
    '%s references only safe or catalogued font families',
    (file) => {
      const json = JSON.parse(
        fs.readFileSync(path.join(TEMPLATE_DIR, file), 'utf8')
      );
      const collect = file.endsWith('.docx.json')
        ? collectFontNamesFromDocx
        : collectFontNamesFromPptx;
      // JSON bindings resolve theme fonts during block expansion. Check the
      // actual font references emitted by the same preparation as rendering.
      const expanded =
        file.endsWith('.docx.json') && json.props?.blocks
          ? prepareDocxQualityDocument(json).model.context.document
          : json;
      const names = [...collect(expanded)];
      expect(names.length).toBeGreaterThan(0);
      // Families the document itself registers (fontRegistry with real
      // sources) are resolvable by definition — the registry is how a
      // non-catalog font like Clash Display ships with its template.
      const registered = new Set<string>(
        (json?.props?.fontRegistry ?? [])
          .filter(
            (e: { sources?: unknown[] }) =>
              Array.isArray(e.sources) && e.sources.length > 0
          )
          .map((e: { family: string }) => e.family.toLowerCase())
      );
      const unresolvable = names.filter(
        (name) =>
          !isSafeFont(name.trim()) &&
          !CATALOG.has(name.trim().toLowerCase()) &&
          !registered.has(name.trim().toLowerCase())
      );
      expect(unresolvable).toEqual([]);
    }
  );
});
