import { vi } from 'vitest';
import type { ThemeConfig } from '../../styles';
import type { ModuleDefinition } from '../../types';

/**
 * Creates a mock theme configuration for testing
 */
export function createMockTheme(overrides?: Partial<ThemeConfig>): ThemeConfig {
  return {
    colors: {
      primary: '000000',
      secondary: '666666',
      accent: '0066CC',
      text: '333333',
      background: 'FFFFFF',
      backgroundPrimary: 'FFFFFF',
      backgroundSecondary: 'F5F5F5',
      textPrimary: '333333',
      textSecondary: '666666',
      ...overrides?.colors,
    },
    fonts: {
      heading: { family: 'Arial', size: 16 },
      body: { family: 'Calibri', size: 11 },
      mono: { family: 'Courier New', size: 10 },
      light: { family: 'Calibri', size: 10 },
      ...overrides?.fonts,
    },
    spacing: {
      section: 240,
      paragraph: 120,
      ...overrides?.spacing,
    },
    ...overrides,
  } as ThemeConfig;
}

/**
 * Creates a mock module definition for testing
 */
export function createMockModule(
  type: string,
  config?: Record<string, unknown>,
  modules?: ModuleDefinition[]
): ModuleDefinition {
  return {
    type,
    config: config || {},
    ...(modules && { modules }),
  } as ModuleDefinition;
}

// Remove mock functions that call vi.mock() inside them
// as they cause hoisting issues
// Each test file should handle its own mocks directly

/**
 * Default test theme name
 */
export const TEST_THEME_NAME = 'modern';