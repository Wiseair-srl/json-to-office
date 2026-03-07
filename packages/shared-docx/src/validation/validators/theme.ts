/**
 * Theme validators
 * @module validation/validators/theme
 * @description
 * Now uses unified validation system
 */

// Re-export everything from unified theme validator
export {
  validateThemeJson,
  isValidTheme as isValidThemeJson,
  getThemeName,
  isThemeConfig,
  type ThemeValidationResult,
} from '../unified/theme-validator';

// Re-export utility for getting validation summary
export { getValidationSummary } from '../unified/base-validator';

// For backward compatibility, provide formatValidationErrors
export function formatValidationErrors(errors: any[]): string[] {
  if (!Array.isArray(errors)) return [];

  return errors.map((error) => {
    if (typeof error === 'string') return error;

    const path = error.path ? `${error.path}: ` : '';
    const message = error.message || 'Validation error';
    return `${path}${message}`;
  });
}
