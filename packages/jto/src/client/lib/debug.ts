/**
 * Debug utility for development logging
 * Logs are only shown when NODE_ENV !== 'production' or when explicitly enabled
 */

const isProduction = process.env.NODE_ENV === 'production';
const debugEnabled =
  typeof window !== 'undefined' &&
  window.localStorage?.getItem('debug') === 'true';

export const debug = {
  /**
   * Log general debug information
   */
  log: (...args: any[]) => {
    if (!isProduction || debugEnabled) {
      console.log(...args);
    }
  },

  /**
   * Log warning information
   */
  warn: (...args: any[]) => {
    if (!isProduction || debugEnabled) {
      console.warn(...args);
    }
  },

  /**
   * Log error information (always logged)
   */
  error: (...args: any[]) => {
    console.error(...args);
  },

  /**
   * Log with a specific namespace/category
   */
  namespace: (ns: string) => ({
    log: (...args: any[]) => {
      if (!isProduction || debugEnabled) {
        console.log(`[${ns}]`, ...args);
      }
    },
    warn: (...args: any[]) => {
      if (!isProduction || debugEnabled) {
        console.warn(`[${ns}]`, ...args);
      }
    },
    error: (...args: any[]) => {
      console.error(`[${ns}]`, ...args);
    },
  }),

  /**
   * Enable debug mode programmatically
   */
  enable: () => {
    if (typeof window !== 'undefined') {
      window.localStorage?.setItem('debug', 'true');
    }
  },

  /**
   * Disable debug mode programmatically
   */
  disable: () => {
    if (typeof window !== 'undefined') {
      window.localStorage?.removeItem('debug');
    }
  },
};
