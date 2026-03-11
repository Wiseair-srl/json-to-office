/**
 * Environment detection utilities
 */

/**
 * Check if the current environment is Node.js
 */
export function isNodeEnvironment(): boolean {
  return (
    typeof process !== 'undefined' &&
    process.versions != null &&
    process.versions.node != null &&
    typeof process.versions.node === 'string'
  );
}
