import { STANDARD_COMPONENTS_REGISTRY } from '@json-to-office/shared-docx';
import { PPTX_STANDARD_COMPONENTS_REGISTRY } from '@json-to-office/shared-pptx';
import type { PluginFormat } from './types';

/**
 * Component names the format already owns. A browser plugin cannot take one
 * of these: the schema would carry two branches for the same `name` and the
 * expander would swallow a standard component.
 */
export function standardComponentNames(format: PluginFormat): Set<string> {
  const registry =
    format === 'docx'
      ? STANDARD_COMPONENTS_REGISTRY
      : PPTX_STANDARD_COMPONENTS_REGISTRY;
  return new Set(registry.map((component) => component.name));
}

/** Names a plugin may use: what disk discovery accepts, roughly a kebab identifier. */
export const PLUGIN_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
