/**
 * Deep Merge Utilities
 * Generic deep-merge helpers used by both docx and pptx
 * componentDefaults resolution systems.
 */

function isObject(item: any): boolean {
  return item !== null && typeof item === 'object' && !Array.isArray(item);
}

function deepMerge<T>(target: any, source: any): T {
  const output = { ...target };

  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach((key) => {
      if (isObject(source[key])) {
        if (!(key in target)) {
          output[key] = source[key];
        } else {
          output[key] = deepMerge(target[key], source[key]);
        }
      } else {
        output[key] = source[key];
      }
    });
  }

  return output as T;
}

/**
 * Merge theme defaults with user-provided configuration.
 * User config takes precedence over theme defaults.
 * Uses deep merge to preserve nested objects.
 * Arrays are replaced wholesale, not merged per-element.
 */
export function mergeWithDefaults<T>(
  userConfig: T,
  themeDefaults: Partial<T>
): T {
  return deepMerge<T>(themeDefaults, userConfig);
}
