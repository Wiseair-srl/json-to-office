/**
 * Environment detection utilities
 */

/**
 * Check if the current environment is Node.js
 * This is used to conditionally load Node.js-only modules
 */
export function isNodeEnvironment(): boolean {
  // Check for Node.js-specific globals
  return (
    typeof process !== 'undefined' &&
    process.versions != null &&
    process.versions.node != null &&
    typeof process.versions.node === 'string'
  );
}

/**
 * Check if Node.js built-in modules are available
 * More specific check for modules that require Node.js built-ins
 */
export function hasNodeBuiltins(): boolean {
  try {
    // Check if we can access Node.js built-in modules
    // This will fail in browser environments
    return (
      typeof require !== 'undefined' ||
      (typeof process !== 'undefined' &&
        typeof process.versions === 'object' &&
        typeof process.versions.node === 'string')
    );
  } catch {
    return false;
  }
}
