/**
 * The two alternate themes, PPTX twins of `vermilion.docx.theme.json` and
 * `devportal.docx.theme.json`.
 *
 * Each shares its palette roles, chart series, chrome recipes and motif with
 * the report theme of the same name, and names the same font families — all
 * of them in SAFE_FONTS, so neither needs a font registry. The projection
 * substitution the consulting twin makes — small roles and the recipes that
 * paint them take `text2` rather than `textMuted` — holds here for the same
 * contrast reason, and the agreement test knows it.
 *
 * Data, not code, for the same reason as `consulting.pptx.theme.json`: the
 * playground's theme discovery scans for `*.pptx.theme.json`.
 */

import type { PptxThemeConfig } from '../types';
import vermilionThemeJson from './vermilion.pptx.theme.json';
import devportalThemeJson from './devportal.pptx.theme.json';

export const VERMILION_PPTX_THEME: PptxThemeConfig =
  vermilionThemeJson as PptxThemeConfig;
export const DEVPORTAL_PPTX_THEME: PptxThemeConfig =
  devportalThemeJson as PptxThemeConfig;
