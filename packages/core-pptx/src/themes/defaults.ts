/**
 * PPTX Theme Defaults
 */

import type { PptxThemeConfig } from '../types';

export const DEFAULT_PPTX_THEME: PptxThemeConfig = {
  name: 'default',
  colors: {
    primary: '4472C4',
    secondary: 'ED7D31',
    accent: '70AD47',
    background: 'FFFFFF',
    text: '333333',
  },
  fonts: {
    heading: 'Arial',
    body: 'Arial',
  },
  defaults: {
    fontSize: 18,
    fontColor: '333333',
  },
};

const PPTX_THEMES: Record<string, PptxThemeConfig> = {
  default: DEFAULT_PPTX_THEME,
  dark: {
    name: 'dark',
    colors: {
      primary: '5B9BD5',
      secondary: 'FF6F61',
      accent: '6BCB77',
      background: '2D2D2D',
      text: 'FFFFFF',
    },
    fonts: {
      heading: 'Arial',
      body: 'Arial',
    },
    defaults: {
      fontSize: 18,
      fontColor: 'FFFFFF',
    },
  },
  minimal: {
    name: 'minimal',
    colors: {
      primary: '000000',
      secondary: '666666',
      accent: '999999',
      background: 'FFFFFF',
      text: '000000',
    },
    fonts: {
      heading: 'Helvetica',
      body: 'Helvetica',
    },
    defaults: {
      fontSize: 18,
      fontColor: '000000',
    },
  },
};

export function getPptxTheme(name: string): PptxThemeConfig {
  return PPTX_THEMES[name] || DEFAULT_PPTX_THEME;
}

export const pptxThemes = PPTX_THEMES;
