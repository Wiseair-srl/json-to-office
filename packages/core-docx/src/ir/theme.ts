/**
 * The document's Word theme: what `word/theme/theme1.xml` names.
 *
 * The slots pair with the jto tokens the way the twin deck's do (#258), so a
 * report and its deck offer the same scheme in Word and PowerPoint. That table
 * is `SCHEME_SLOTS` in `core-pptx/src/renderers/office-open/index.ts`; it is
 * module-private, so it is restated here with each PPTX token swapped for its
 * DOCX twin (`text2` → `textSecondary`, `background2` → `backgroundSecondary`).
 *
 * `dark1` is `text`, not `textPrimary`, although `bundled-themes.test.ts` pins
 * the PPTX twin of `text` to `textPrimary`: body text resolves `text`, so Text 1
 * should be the colour the document's text is actually set in. The two are
 * equal in every bundled theme. Do not "fix" it.
 *
 * Fonts are Latin only. A jto theme has one family per role; written into the
 * East Asian or complex-script slot it would send Word's CJK or Arabic text to a
 * face without those glyphs. Left empty, Word picks one per script from
 * Office's supplemental list, which the backends keep. The family is the base
 * one, not a synthesized weight alias, so (Headings) names a real family.
 *
 * Nothing here is referred to from a style or a run: no `w:themeColor`, no
 * `w:asciiTheme`. Every colour and face the document's text and shapes draw
 * stays stated hex and a stated family. The one exception is a native chart,
 * which on both backends writes what Word's own charts do: a tint of Text 1 on
 * its gridlines and axis lines and Background 1 on pie and doughnut slice
 * borders (`docxjs` also names the theme's East Asian body font beside every
 * stated Latin face). Apart from those lines, the theme part changes what Word
 * offers someone editing the document and nothing it renders.
 */

import type { ThemeConfig } from '../styles';
import { resolveColor } from '../styles/utils/colorUtils';
import { resolveFontFamily } from '../styles/utils/styleHelpers';
import {
  NOT_XML_CHAR,
  type DocxIrTheme,
  type DocxIrThemeColorSlot,
} from './types';

/** Scheme slot ← the jto DOCX colour token it holds. hlink/folHlink have none. */
export const THEME_COLOR_TOKENS: ReadonlyArray<
  readonly [DocxIrThemeColorSlot, string]
> = [
  ['dark1', 'text'],
  ['light1', 'background'],
  ['dark2', 'textSecondary'],
  ['light2', 'backgroundSecondary'],
  ['accent1', 'primary'],
  ['accent2', 'secondary'],
  ['accent3', 'accent'],
  ['accent4', 'accent4'],
  ['accent5', 'accent5'],
  ['accent6', 'accent6'],
];

const NOT_XML_CHARS = new RegExp(NOT_XML_CHAR.source, 'gu');

const xmlText = (value: string | undefined): string =>
  (value ?? '').replace(NOT_XML_CHARS, '').trim();

/**
 * The IR theme for a resolved jto theme.
 *
 * The name is the theme's `name` (`consulting`), else the name the document
 * asked for, else Office's. Characters XML cannot carry are dropped from the
 * name and the fonts: production does not validate the IR, so the compiler has
 * to produce values a backend can write as they are.
 */
export function compileTheme(
  theme: ThemeConfig,
  themeName: string
): DocxIrTheme {
  const colors: DocxIrTheme['colors'] = {};
  for (const [slot, token] of THEME_COLOR_TOKENS) {
    const hex = schemeHex(token, theme);
    if (hex) colors[slot] = { hex };
  }
  const headingFont = xmlText(resolveFontFamily(theme, 'heading'));
  const bodyFont = xmlText(resolveFontFamily(theme, 'body'));
  return {
    name: xmlText(theme.name) || xmlText(themeName) || 'Office Theme',
    colors,
    ...(headingFont ? { headingFont } : {}),
    ...(bodyFont ? { bodyFont } : {}),
  };
}

/**
 * An unset or unresolvable slot keeps Office's colour rather than failing the
 * document: every colour the document itself uses was already resolved (and
 * would have thrown) elsewhere.
 */
function schemeHex(token: string, theme: ThemeConfig): string | undefined {
  try {
    return resolveColor(token, theme);
  } catch {
    return undefined;
  }
}
