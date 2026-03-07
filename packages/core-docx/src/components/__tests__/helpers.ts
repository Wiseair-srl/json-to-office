/**
 * Test helper utilities for component tests
 */

import type { ThemeConfig } from '../../styles';

/**
 * Test theme name constant
 */
export const TEST_THEME_NAME = 'test-theme';

/**
 * Create a mock theme configuration for testing
 */
export function createMockTheme(): ThemeConfig {
  return {
    name: TEST_THEME_NAME,
    fonts: {
      heading: { family: 'Arial', size: 16 },
      body: { family: 'Arial', size: 11 },
      mono: { family: 'Courier New', size: 10 },
      light: { family: 'Arial', size: 10 },
    },
    colors: {
      primary: '#0066cc',
      secondary: '#6c757d',
      accent: '#17a2b8',
      text: '#000000',
      background: '#FFFFFF',
      backgroundPrimary: '#FFFFFF',
      backgroundSecondary: '#f0f0f0',
      textPrimary: '#000000',
      textSecondary: '#666666',
    },
    styles: {
      normal: {
        font: 'body',
        size: 11,
        color: '#000000',
      },
    },
    page: {
      dimensions: {
        width: 11906,
        height: 16838,
      },
      margins: {
        top: 1440,
        right: 1440,
        bottom: 1440,
        left: 1440,
        header: 720,
        footer: 720,
      },
    },
  } as ThemeConfig;
}
