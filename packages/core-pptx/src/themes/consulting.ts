/**
 * The consulting house theme, PPTX twin of `consulting.docx.theme.json`.
 *
 * Shares every visual token with the DOCX theme — ink, three greys, one deep
 * blue, positive/negative, the ordered chart series, Arial over Calibri with
 * Consolas for code — so a deck and its report match without restyling. A
 * guard test pins the agreement.
 *
 * Values only. The theme paints action titles, trackers, sources and footers
 * through its chrome recipes and type roles; whether a slide must carry them
 * is a quality profile's decision (`consulting-deck`), never the theme's.
 *
 * SAFE_FONTS only: nothing here needs a font registry on any Office install.
 *
 * One projection differs from the report: the small roles — footer, tracker,
 * source — and the chrome recipes that paint them take `text2` rather than
 * `textMuted`. On a projected slide a 9pt run in the light grey sits under
 * the 4.5 : 1 the contrast rule asks of small text; the darker grey passes it
 * and reads as the same voice. The agreement test knows this one substitution.
 */

import type { PptxThemeConfig } from '../types';
import consultingThemeJson from './consulting.pptx.theme.json';

/**
 * Data, not code: the theme lives in `consulting.pptx.theme.json` so the
 * playground's theme discovery — a scan for `*.pptx.theme.json`, the way the
 * DOCX built-ins are found — lists it beside the deck. The bundled-themes test
 * validates the file against the theme schema and pins it to the DOCX twin.
 */
export const CONSULTING_PPTX_THEME: PptxThemeConfig =
  consultingThemeJson as PptxThemeConfig;
