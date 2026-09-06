/**
 * The reference block catalog on the server: every block definition the
 * discovered documents of a format carry, with a working invocation and its
 * dependencies. Served to the editor by `/discovery/blocks` and written into
 * the AI assistant's PPTX prompt so "prefer the reference blocks" comes with
 * the definitions to copy.
 *
 * Discovery reads the disk; the catalog is memoized briefly so a burst of
 * completions or chat turns does not rescan it, and long enough that editing
 * a template on disk shows up within a few seconds.
 */
import { readFile } from 'node:fs/promises';
import { PluginDiscoveryService } from '@json-to-office/jto-cli';
import {
  blockReferencesFromDocument,
  type BlockReference,
} from '@json-to-office/shared';

const TTL_MS = 10_000;
const cache = new Map<string, { at: number; references: BlockReference[] }>();

export async function discoverBlockReferences(
  format: 'docx' | 'pptx'
): Promise<BlockReference[]> {
  const cached = cache.get(format);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.references;
  const discovery = new PluginDiscoveryService({
    maxDepth: 10,
    includeNodeModules: false,
    verbose: false,
  });
  const documents = await discovery.discoverDocuments(format);
  const references: BlockReference[] = [];
  for (const document of documents) {
    try {
      references.push(
        ...blockReferencesFromDocument(
          JSON.parse(await readFile(document.path, 'utf-8')),
          { template: document.name, format }
        )
      );
    } catch {
      /* not a document, or one whose definitions do not validate */
    }
  }
  cache.set(format, { at: Date.now(), references });
  return references;
}

/** Forget the catalog; the next call rescans. */
export function resetBlockReferenceCache(): void {
  cache.clear();
}

/**
 * The catalog as prompt text: each block's name, source, description, slot
 * contract, the definition to copy and an invocation that fills it.
 */
export function blockReferencesPrompt(
  references: readonly BlockReference[]
): string {
  if (!references.length)
    return '_No reference blocks are available on this server; define the blocks the deck needs yourself._';
  return references
    .map((reference) => {
      const slots = Object.entries(reference.definition.slots).map(
        ([name, slot]) => {
          const facts = [
            slot.type,
            slot.required && slot.default === undefined ? 'required' : '',
            slot.role ? `role ${slot.role}` : '',
            slot.maxWords ? `≤ ${slot.maxWords} words` : '',
            slot.oneLine ? 'one line' : '',
            slot.default !== undefined
              ? `default ${JSON.stringify(slot.default)}`
              : '',
          ].filter(Boolean);
          return `- \`${name}\` — ${facts.join(', ')}${slot.description ? `: ${slot.description}` : ''}`;
        }
      );
      const dependencies = reference.dependencies.length
        ? `\nAlso copy: ${reference.dependencies.map((name) => `\`${name}\``).join(', ')} (invoked by this definition).`
        : '';
      return [
        `### \`${reference.name}\` (from ${reference.template})`,
        reference.description,
        slots.length ? slots.join('\n') : '_No slots._',
        `Definition to copy into \`props.blocks\`:${dependencies}`,
        '```json',
        JSON.stringify({ [reference.name]: reference.definition }, null, 2),
        '```',
        'Invocation:',
        '```json',
        JSON.stringify(reference.example, null, 2),
        '```',
      ]
        .filter(Boolean)
        .join('\n\n');
    })
    .join('\n\n');
}
