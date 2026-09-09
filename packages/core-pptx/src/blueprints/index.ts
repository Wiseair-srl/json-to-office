/**
 * PPTX blueprints: deck archetypes as data, and the one operation that turns
 * one into a deck.
 *
 * The registry is the JSON files under `templates/blueprints`: the bundled
 * ones are imported so a stale or missing `dist` cannot lose them, and the
 * directory is scanned for any other `*.pptx.blueprint.json` beside it, so
 * adding a blueprint is a file. What instantiating means is shared with the
 * DOCX core; this module only says what a deck's root looks like: the
 * metadata a deck carries (`title`, `author`, `company`) sits directly under
 * `props`, beside the canvas the blueprint's blocks were drawn for.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  instantiateBlueprint,
  registerBlueprints,
  type Blueprint,
  type BlueprintFillEntry,
  type InstantiateBlueprintOptions,
  type InstantiatedBlueprint,
} from '@json-to-office/shared';
import { collectPlaceholders } from '@json-to-office/quality';
import consultingDeck from '../templates/blueprints/consulting-deck.pptx.blueprint.json';

/**
 * Blueprint files beside this module — `src/templates/blueprints` from source,
 * `dist/templates/blueprints` from the built package — that the static import
 * above does not already carry.
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
    .filter((file) => file.endsWith('.pptx.blueprint.json'))
    .map((file) => JSON.parse(readFileSync(join(directory, file), 'utf8')))
    .filter((candidate) => {
      const id = (candidate as { id?: unknown } | null)?.id;
      return !(typeof id === 'string' && id in known);
    });
}

const bundled = registerBlueprints('pptx', [consultingDeck]);

/** Every bundled PPTX blueprint, by id. */
export const PPTX_BLUEPRINTS: Readonly<Record<string, Blueprint>> = {
  ...bundled,
  ...registerBlueprints('pptx', scanned(bundled)),
};

export function pptxBlueprint(id: string): Blueprint | undefined {
  return PPTX_BLUEPRINTS[id];
}

export type {
  BlueprintFillEntry,
  InstantiateBlueprintOptions,
  InstantiatedBlueprint,
};

/** The wide canvas every bundled deck block is drawn for; any canvas lays out. */
const CANVAS = { slideWidth: 13.333, slideHeight: 7.5 } as const;

export function instantiatePptxBlueprint(
  blueprint: Blueprint,
  options: InstantiateBlueprintOptions
): InstantiatedBlueprint {
  return instantiateBlueprint(blueprint, options, {
    format: 'pptx',
    props: CANVAS,
    metadataPointer: '/props',
    markers: (document) =>
      collectPlaceholders(document).filter(
        (occurrence) => occurrence.match.kind === 'scaffold-marker'
      ),
  });
}
