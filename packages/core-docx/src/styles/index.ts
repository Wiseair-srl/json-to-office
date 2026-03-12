/**
 * Main styles module export
 * This file provides a unified interface to the styles system
 */

// Base configurations - imported from TypeBox schemas
export type {
  ThemeConfigJson as ThemeConfig,
  StyleDefinitions,
  DocumentMargins,
  PageDimensions,
  Page,
  FontDefinition,
  Fonts,
  ComponentDefaults,
  HeadingComponentDefaults,
  ParagraphComponentDefaults,
  ImageComponentDefaults,
  StatisticComponentDefaults,
  TableComponentDefaults,
  SectionComponentDefaults,
  ColumnsComponentDefaults,
  ListComponentDefaults,
} from '@json-to-office/shared-docx';
export {
  themes,
  getTheme,
  getThemeNames,
  getThemeWithFallback,
  hasTheme,
  isValidThemeName,
} from '../templates/themes';

// Export ThemeName type separately
export type { ThemeName } from '../templates/themes';

// Style utilities
export { getBodyTextStyle } from './utils/styleHelpers';
export {
  getTableStyle,
  getDocumentMargins,
  getPageSetup,
} from './utils/layoutUtils';

// Theme configurations
export {
  minimalTheme,
  corporateTheme,
  modernTheme,
} from '../templates/themes';

// JSON Theme System (Phase 1 - Foundation complete)
export {
  ThemeConfigSchema,
  isValidThemeConfig,
  loadThemeFromJson,
  loadThemeFromFile,
  exportThemeToJson,
  validateThemeJsonString,
  ThemeValidationError,
  ThemeParseError,
  ThemeFileError,
} from '../themes/json';

// Export type separately
export type { ThemeConfigJson } from '../themes/json';

// All themes now use the same structure
// No need for backward compatibility exports
