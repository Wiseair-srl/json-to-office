/**
 * PPTX Theme Defaults
 */

import type { PptxComponentDefaults } from '@json-to-office/shared-pptx';
import type { PptxThemeConfig, TextStyle, StyleName } from '../types';

/**
 * What a table looks like before anyone styles one.
 *
 * With no defaults at all a PPTX table drew as bare text in columns — no rule
 * between cells, nothing marking the first row — so every deck had to restate
 * the same properties to get something presentable. Theme tokens rather than
 * hex, so each palette answers for its own lines.
 *
 * No `margin`: cell insets are a capability the `office-open` renderer does not
 * have, and a theme default that every table inherits would turn a backend that
 * works into one that refuses every table on it. It stays opt-in per table,
 * where the refusal is the author's own choice to make.
 *
 * A document overrides any of this per table, or wholesale through
 * `componentDefaults.table`; `headerRow: false` turns the first-row treatment
 * off for a table that is not a table of anything.
 */
const DEFAULT_TABLE: PptxComponentDefaults['table'] = {
  border: { type: 'solid', pt: 1, color: 'background2' },
  headerRow: true,
};

const DEFAULT_STYLES: Partial<Record<StyleName, TextStyle>> = {
  title: { fontSize: 36, bold: true, fontColor: 'text', align: 'center' },
  subtitle: { fontSize: 20, italic: true, fontColor: 'text2', align: 'center' },
  heading1: { fontSize: 28, bold: true, fontColor: 'primary' },
  heading2: { fontSize: 22, bold: true, fontColor: 'primary' },
  heading3: { fontSize: 18, bold: true, fontColor: 'text' },
  body: { fontSize: 14 },
  caption: { fontSize: 10, italic: true, fontColor: 'text2' },
};

export const DEFAULT_PPTX_THEME: PptxThemeConfig = {
  name: 'default',
  colors: {
    primary: '#4472C4',
    secondary: '#ED7D31',
    accent: '#70AD47',
    background: '#FFFFFF',
    text: '#333333',
    text2: '#44546A',
    background2: '#E7E6E6',
    accent4: '#FFC000',
    accent5: '#5B9BD5',
    accent6: '#70AD47',
  },
  fonts: {
    heading: 'Arial',
    body: 'Arial',
  },
  defaults: {
    fontSize: 18,
    fontColor: '#333333',
  },
  styles: DEFAULT_STYLES,
  componentDefaults: { table: DEFAULT_TABLE },
};

const PPTX_THEMES: Record<string, PptxThemeConfig> = {
  default: DEFAULT_PPTX_THEME,
  dark: {
    name: 'dark',
    colors: {
      primary: '#5B9BD5',
      secondary: '#FF6F61',
      accent: '#6BCB77',
      background: '#2D2D2D',
      text: '#FFFFFF',
      text2: '#CCCCCC',
      background2: '#3D3D3D',
      accent4: '#FFB347',
      accent5: '#77DD77',
      accent6: '#AEC6CF',
    },
    fonts: {
      heading: 'Arial',
      body: 'Arial',
    },
    defaults: {
      fontSize: 18,
      fontColor: '#FFFFFF',
    },
    styles: DEFAULT_STYLES,
    componentDefaults: { table: DEFAULT_TABLE },
  },
  minimal: {
    name: 'minimal',
    colors: {
      primary: '#000000',
      secondary: '#666666',
      accent: '#999999',
      background: '#FFFFFF',
      text: '#000000',
      text2: '#444444',
      background2: '#F5F5F5',
      accent4: '#BBBBBB',
      accent5: '#DDDDDD',
      accent6: '#888888',
    },
    fonts: {
      heading: 'Helvetica',
      body: 'Helvetica',
    },
    defaults: {
      fontSize: 18,
      fontColor: '#000000',
    },
    styles: DEFAULT_STYLES,
    componentDefaults: { table: DEFAULT_TABLE },
  },
};

export function getPptxTheme(name: string): PptxThemeConfig {
  return PPTX_THEMES[name] || DEFAULT_PPTX_THEME;
}

/**
 * Whether `name` is a known built-in theme. `getPptxTheme` never misses (it
 * falls back to the default theme), so callers that need to distinguish "a
 * real built-in" from "an unknown name" must check here first.
 */
export function hasPptxTheme(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(PPTX_THEMES, name);
}

export const pptxThemes = PPTX_THEMES;
