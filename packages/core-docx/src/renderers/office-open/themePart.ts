/**
 * The document's Word theme, for the `office-open` backend.
 *
 * `@office-open/docx` always writes Office's theme part and takes no option
 * for another: `createThemeXml()` is called with no arguments, and the only
 * hook, `rawParts`, would replace the whole part, which means owning a
 * complete theme document — format scheme included — instead of the backend.
 * So the IR theme is spliced into the part the backend wrote: its name, the
 * scheme colours it sets and the Latin faces of the major and minor fonts,
 * as docx.js writes them from the same IR. Everything else in the part —
 * hlink and folHlink unless set, the format scheme, the empty East Asian and
 * complex-script faces — stays the backend's.
 *
 * Unlike docx.js, this backend's own output refers to the theme: the built-in
 * styles it adds and the first run of every contents field name theme colours
 * and fonts. Replacing Office's theme with the document's is what makes those
 * follow the document rather than Office.
 *
 * Every edit has to find its element exactly once. A part whose shape
 * changed under a backend upgrade fails the render rather than shipping a
 * theme half Office's and half the document's.
 */

import type AdmZip from 'adm-zip';
import type { DocxIrTheme, DocxIrThemeColorSlot } from '../../ir/types';

const THEME_PART = 'word/theme/theme1.xml';

/** The DrawingML element of each scheme slot. */
const SCHEME_ELEMENT: Readonly<Record<DocxIrThemeColorSlot, string>> = {
  dark1: 'dk1',
  light1: 'lt1',
  dark2: 'dk2',
  light2: 'lt2',
  accent1: 'accent1',
  accent2: 'accent2',
  accent3: 'accent3',
  accent4: 'accent4',
  accent5: 'accent5',
  accent6: 'accent6',
  hyperlink: 'hlink',
  followedHyperlink: 'folHlink',
};

/**
 * Office's own Latin face for each font. The backend writes it with its
 * PANOSE, which a family equal to it keeps — as docx.js does, role by role.
 */
const OFFICE_FACES = [
  ['majorFont', 'headingFont', 'Calibri Light'],
  ['minorFont', 'bodyFont', 'Calibri'],
] as const;

/** The characters docx.js escapes in an attribute value, `&` first. */
const esc = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

/**
 * Replace the one match of a global pattern, or throw. The replacer is always
 * a function: a theme name may hold `$`, which a replacement string would
 * read as a group reference.
 */
function replaceOnce(
  xml: string,
  pattern: RegExp,
  replacer: (...groups: string[]) => string,
  what: string
): string {
  const count = [...xml.matchAll(pattern)].length;
  if (count !== 1) {
    throw new Error(
      `office-open's theme part has ${count} ${what}, expected one`
    );
  }
  return xml.replace(pattern, replacer);
}

/** Rename one of the theme's elements after the theme. */
const renamed = (xml: string, element: string, name: string): string =>
  replaceOnce(
    xml,
    new RegExp(`(<a:${element}\\b[^>]*?\\bname=")[^"]*(")`, 'g'),
    (_match, open, close) => `${open}${name}${close}`,
    `a:${element} name`
  );

/** Write the IR theme into the theme part the backend wrote. */
export function spliceTheme(zip: AdmZip, theme: DocxIrTheme): void {
  const entry = zip.getEntry(THEME_PART);
  if (!entry) throw new Error(`office-open wrote no ${THEME_PART}`);
  let xml = entry.getData().toString('utf8');
  const name = esc(theme.name);

  // `\b` keeps `a:themeElements` out.
  xml = renamed(xml, 'theme', name);

  const colors = Object.entries(theme.colors) as Array<
    [DocxIrThemeColorSlot, { hex: string } | undefined]
  >;
  if (colors.some(([, color]) => color)) {
    xml = renamed(xml, 'clrScheme', name);
    for (const [slot, color] of colors) {
      if (!color) continue;
      const element = SCHEME_ELEMENT[slot];
      xml = replaceOnce(
        xml,
        new RegExp(`<a:${element}>[\\s\\S]*?</a:${element}>`, 'g'),
        () => `<a:${element}><a:srgbClr val="${color.hex}"/></a:${element}>`,
        `a:${element}`
      );
    }
  }

  if (theme.headingFont || theme.bodyFont) {
    xml = renamed(xml, 'fontScheme', name);
    for (const [collection, key, officeFace] of OFFICE_FACES) {
      const family = theme[key];
      if (family === undefined || family === officeFace) continue;
      xml = replaceOnce(
        xml,
        new RegExp(`(<a:${collection}>)<a:latin\\b[^>]*/>`, 'g'),
        (_match, open) => `${open}<a:latin typeface="${esc(family)}"/>`,
        `a:${collection} a:latin`
      );
    }
  }

  zip.updateFile(THEME_PART, Buffer.from(xml, 'utf8'));
}
