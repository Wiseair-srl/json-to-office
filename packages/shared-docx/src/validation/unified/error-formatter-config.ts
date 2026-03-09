/**
 * Error Formatter Configuration
 * Configurable error message formatting options
 */

/**
 * Error formatter configuration options
 */
export interface ErrorFormatterConfig {
  /**
   * Include emoji indicators in error messages
   * Default: true (false in CI environments)
   */
  includeEmojis?: boolean;

  /**
   * Verbosity level for error messages
   * - minimal: Just the error message
   * - normal: Error message with path
   * - detailed: Full error with suggestions and context
   * Default: 'normal'
   */
  verbosity?: 'minimal' | 'normal' | 'detailed';

  /**
   * Include suggestions for fixing errors
   * Default: true
   */
  includeSuggestions?: boolean;

  /**
   * Include stack trace or error path
   * Default: true
   */
  includePath?: boolean;

  /**
   * Maximum error message length (0 = unlimited)
   * Default: 0
   */
  maxMessageLength?: number;

  /**
   * Include links to documentation
   * Default: false
   */
  includeDocLinks?: boolean;

  /**
   * Terminal color support
   * Default: auto-detected
   */
  colorSupport?: boolean;
}

/**
 * Get default configuration
 * Evaluates environment variables at call time, not module load time
 */
function getDefaultConfig(): Required<ErrorFormatterConfig> {
  return {
    includeEmojis: !isCI(),
    verbosity: 'normal',
    includeSuggestions: true,
    includePath: true,
    maxMessageLength: 0,
    includeDocLinks: false,
    colorSupport: hasColorSupport(),
  };
}

/**
 * Default configuration (for backward compatibility)
 */
export const DEFAULT_ERROR_CONFIG: Required<ErrorFormatterConfig> =
  getDefaultConfig();

/**
 * Error message templates
 */
export const ERROR_TEMPLATES = {
  UNION_NO_MATCH: 'Value doesn\'t match any of the expected formats',
  TYPE_MISMATCH: 'Expected {expected} but got {actual}',
  MISSING_REQUIRED: 'Missing required field \'{field}\'',
  UNKNOWN_PROPERTY: 'Unknown property \'{property}\'',
  INVALID_FORMAT: 'Invalid {type} format',
  PATTERN_MISMATCH: 'Value doesn\'t match the required pattern',
} as const;

/**
 * Emoji indicators for different error types
 */
export const ERROR_EMOJIS = {
  ERROR: '❌',
  WARNING: '⚠️',
  INFO: 'ℹ️',
  SUGGESTION: '💡',
  FIX: '🔧',
  LINK: '🔗',
} as const;

/**
 * Documentation links for common errors
 */
export const DOC_LINKS = {
  MODULE_TYPES: 'https://docs.json-to-docx.com/modules',
  THEME_CONFIG: 'https://docs.json-to-docx.com/themes',
  VALIDATION: 'https://docs.json-to-docx.com/validation',
} as const;

/**
 * Detect if running in CI environment
 */
function isCI(): boolean {
  // Check if we're in a Node environment
  if (typeof process === 'undefined' || !process.env) {
    return false;
  }

  return !!(
    process.env.CI ||
    process.env.CONTINUOUS_INTEGRATION ||
    process.env.GITHUB_ACTIONS ||
    process.env.GITLAB_CI ||
    process.env.CIRCLECI ||
    process.env.TRAVIS ||
    process.env.JENKINS_URL
  );
}

/**
 * Detect terminal color support
 */
function hasColorSupport(): boolean {
  // Check if we're in a Node environment
  if (typeof process === 'undefined') {
    return false;
  }

  // Check for explicit NO_COLOR env var
  if (process.env?.NO_COLOR) {
    return false;
  }

  // Check for explicit FORCE_COLOR env var
  if (process.env?.FORCE_COLOR) {
    return true;
  }

  // Check if stdout is a TTY
  if (process.stdout?.isTTY) {
    return true;
  }

  // Default to no color in CI environments
  return !isCI();
}

/**
 * Create a configuration with defaults
 */
export function createErrorConfig(
  config?: ErrorFormatterConfig
): Required<ErrorFormatterConfig> {
  // Get fresh defaults that evaluate environment at call time
  const defaults = getDefaultConfig();
  return {
    ...defaults,
    ...config,
  };
}

/**
 * Format an error message based on configuration
 */
export function formatErrorMessage(
  message: string,
  config: ErrorFormatterConfig = {}
): string {
  const finalConfig = createErrorConfig(config);

  let formatted = message;

  // Remove emojis if not wanted
  if (!finalConfig.includeEmojis) {
    Object.values(ERROR_EMOJIS).forEach((emoji) => {
      formatted = formatted.replace(new RegExp(emoji, 'g'), '');
    });
    // Clean up extra spaces
    formatted = formatted.replace(/\s+/g, ' ').trim();
  }

  // Truncate if needed
  if (
    finalConfig.maxMessageLength > 0 &&
    formatted.length > finalConfig.maxMessageLength
  ) {
    formatted =
      formatted.substring(0, finalConfig.maxMessageLength - 3) + '...';
  }

  return formatted;
}
