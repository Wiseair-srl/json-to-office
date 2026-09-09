/**
 * DOCX blueprints: document archetypes as data, and the one operation that
 * turns one into a document.
 *
 * The registry is the JSON files under `templates/blueprints`: the bundled
 * ones are imported so a stale or missing `dist` cannot lose them, and the
 * directory is scanned for any other `*.docx.blueprint.json` beside it, so
 * adding a blueprint is a file. Each is validated against the shared
 * blueprint schema when this module loads, so a malformed one fails at import
 * rather than at scaffold time. What instantiating means — copying a variant,
 * carrying the definitions it invokes and their dependencies, listing every
 * `{{…}}` marker with its slot budget and guidance — is shared with the PPTX
 * core; this module only says what a document's root looks like: metadata
 * under `props.metadata`. Nothing here composes or styles.
 */
import {
  instantiateBlueprint,
  registerBlueprints,
  valueAt,
  type Blueprint,
  type BlueprintFillEntry,
  type InstantiateBlueprintOptions,
  type InstantiatedBlueprint,
} from '@json-to-office/shared';
import { collectPlaceholders } from '@json-to-office/quality';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import clientReport from '../templates/blueprints/client-report.docx.blueprint.json';
import technicalReport from '../templates/blueprints/technical-report.docx.blueprint.json';

/**
 * Blueprint files beside this module — `src/templates/blueprints` when run
 * from source, `dist/templates/blueprints` from the built package — that the
 * static import above does not already carry.
 */
function scanned(known: Readonly<Record<string, unknown>>): unknown[] {
  let here: string;
  try {
    here = dirname(fileURLToPath(import.meta.url));
  } catch {
    return [];
  }
  const directory = [
    join(here, '../templates/blueprints'),
    join(here, 'templates/blueprints'),
  ].find((path) => existsSync(path));
  if (!directory) return [];
  return readdirSync(directory)
    .filter((file) => file.endsWith('.docx.blueprint.json'))
    .map((file) => JSON.parse(readFileSync(join(directory, file), 'utf8')))
    .filter((candidate) => {
      const id = (candidate as { id?: unknown } | null)?.id;
      return !(typeof id === 'string' && id in known);
    });
}

const bundled = registerBlueprints('docx', [clientReport, technicalReport]);

/** Every bundled DOCX blueprint, by id. */
export const DOCX_BLUEPRINTS: Readonly<Record<string, Blueprint>> = {
  ...bundled,
  ...registerBlueprints('docx', scanned(bundled)),
};

export function docxBlueprint(id: string): Blueprint | undefined {
  return DOCX_BLUEPRINTS[id];
}

export type {
  BlueprintFillEntry,
  InstantiateBlueprintOptions,
  InstantiatedBlueprint,
};
export { valueAt };

export function instantiateDocxBlueprint(
  blueprint: Blueprint,
  options: InstantiateBlueprintOptions
): InstantiatedBlueprint {
  return instantiateBlueprint(blueprint, options, {
    format: 'docx',
    metadataPointer: '/props/metadata',
    markers: (document) =>
      collectPlaceholders(document).filter(
        (occurrence) => occurrence.match.kind === 'scaffold-marker'
      ),
  });
}
