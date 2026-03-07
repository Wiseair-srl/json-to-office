import { latestVersion } from '@json-to-office/shared-docx';
import type { ComponentVersion, ComponentVersionMap } from './createComponent';

/**
 * Resolve the correct version entry for a component.
 *
 * - If `requestedVersion` is provided and found, return it.
 * - If `requestedVersion` is provided but missing, throw with available versions.
 * - If `requestedVersion` is absent, return the latest semver version.
 */
export function resolveComponentVersion(
  componentName: string,
  versions: ComponentVersionMap,
  requestedVersion?: string
): ComponentVersion {
  const versionKeys = Object.keys(versions);

  if (requestedVersion) {
    const entry = versions[requestedVersion];
    if (!entry) {
      throw new Error(
        `Component "${componentName}" does not have version "${requestedVersion}". ` +
          `Available versions: ${versionKeys.join(', ')}`
      );
    }
    return entry;
  }

  const latest = latestVersion(versionKeys);
  return versions[latest];
}
