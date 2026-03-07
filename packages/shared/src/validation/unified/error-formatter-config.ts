export interface ErrorFormatterConfig {
  includeEmojis?: boolean;
  verbosity?: 'minimal' | 'normal' | 'detailed';
  includeSuggestions?: boolean;
  includePath?: boolean;
  maxMessageLength?: number;
  includeDocLinks?: boolean;
  colorSupport?: boolean;
}

function isCI(): boolean {
  if (typeof process === 'undefined' || !process.env) return false;
  return !!(process.env.CI || process.env.GITHUB_ACTIONS || process.env.GITLAB_CI);
}

function hasColorSupport(): boolean {
  if (typeof process === 'undefined') return false;
  if (process.env?.NO_COLOR) return false;
  if (process.env?.FORCE_COLOR) return true;
  if (process.stdout?.isTTY) return true;
  return !isCI();
}

export const DEFAULT_ERROR_CONFIG: Required<ErrorFormatterConfig> = {
  includeEmojis: !isCI(),
  verbosity: 'normal',
  includeSuggestions: true,
  includePath: true,
  maxMessageLength: 0,
  includeDocLinks: false,
  colorSupport: hasColorSupport(),
};

export function createErrorConfig(
  config?: ErrorFormatterConfig
): Required<ErrorFormatterConfig> {
  return { ...DEFAULT_ERROR_CONFIG, ...config };
}

export const ERROR_EMOJIS = {
  ERROR: '\u274c',
  WARNING: '\u26a0\ufe0f',
  FIX: '\ud83d\udd27',
  INFO: '\u2139\ufe0f',
  SUCCESS: '\u2705',
};

export function formatErrorMessage(
  message: string,
  config: Required<ErrorFormatterConfig>
): string {
  if (config.maxMessageLength > 0 && message.length > config.maxMessageLength) {
    return message.substring(0, config.maxMessageLength) + '...';
  }
  return message;
}
