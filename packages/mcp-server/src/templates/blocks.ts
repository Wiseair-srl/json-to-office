import {
  blockReferencesFromDocument,
  type BlockReference,
} from '@json-to-office/shared';
import { galleryDocument, galleryManifests } from './gallery.js';
import type { FormatName } from '../lib/adapters.js';

export type { BlockReference };

/**
 * Agentic-authoring references extracted from the complete gallery documents:
 * each definition with its slot schema, a working invocation (the document's
 * own, at the cardinality its author chose) and the definitions it depends
 * on. The same shape the playground's editor completes and inserts from.
 */
export function blockReferenceCatalog(format?: FormatName): BlockReference[] {
  return galleryManifests(format).flatMap((template) =>
    blockReferencesFromDocument(galleryDocument(template.name), {
      template: template.name,
      format: template.format,
    })
  );
}

export const BLOCK_REFERENCE_GUIDANCE =
  'Authoring references extracted from complete playground templates. Copy the chosen definition and the definitions it lists under dependencies into your document’s props.blocks before invoking it; example is a valid invocation to adapt. These names are not registered runtime blocks. Inspect the slots schema and supply required content. Read /props/blocks with jto_workspace_inspect to see the actual definitions in a workspace. Code plugins remain explicit registered dependencies.';
