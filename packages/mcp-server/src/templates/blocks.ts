import {
  blockPointerKey,
  readBlockDefinitions,
  blockSlotsJsonSchema,
  type JsonBlockDefinition,
} from '@json-to-office/shared';
import { galleryDocument, galleryManifests } from './gallery.js';
import type { FormatName } from '../lib/adapters.js';

/** Agentic-authoring examples extracted from complete playground documents. */
export interface BlockReference {
  name: string;
  format: FormatName;
  template: string;
  definitionPointer: string;
  description: string;
  definition: JsonBlockDefinition;
  slotsSchema: Record<string, unknown>;
  usage: {
    name: 'block';
    props: { ref: string; slots: Record<string, unknown> };
  };
}

export function blockReferenceCatalog(format?: FormatName): BlockReference[] {
  return galleryManifests(format).flatMap((template) => {
    const document = galleryDocument(template.name);
    return Object.entries(readBlockDefinitions(document)).map(
      ([name, definition]) => ({
        name,
        format: template.format,
        template: template.name,
        definitionPointer: `/props/blocks/${blockPointerKey(name)}`,
        description: definition.description ?? '',
        definition,
        slotsSchema: blockSlotsJsonSchema(definition),
        usage: {
          name: 'block' as const,
          props: {
            ref: name,
            slots: Object.fromEntries(
              Object.entries(definition.slots)
                .filter(([, slot]) => slot.default !== undefined)
                .map(([key, slot]) => [key, slot.default])
            ),
          },
        },
      })
    );
  });
}

export const BLOCK_REFERENCE_GUIDANCE =
  'Authoring references extracted from complete playground templates. Copy the chosen definition and its transitive block dependencies into your document’s props.blocks before invoking it. These names are not registered runtime blocks. Inspect the slots schema and supply required content. Read /props/blocks with jto_workspace_inspect to see the actual definitions in a workspace. Code plugins remain explicit registered dependencies.';
