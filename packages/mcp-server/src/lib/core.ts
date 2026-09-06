/**
 * The cores, loaded from where they actually live.
 *
 * `@json-to-office/core-docx` and `core-pptx` are dependencies of `jto-ops`,
 * not of this package, so under pnpm's strict layout a bare specifier here
 * resolves to nothing. A resolver rooted at `jto-ops` finds them the way
 * `jto-ops` itself does, and one memoised dynamic import per format serves
 * every caller — theme names for discovery, blueprints for discovery, the
 * resource and the scaffold — without each of them repeating the dance.
 *
 * Everything is optional on the way out: a core that cannot be loaded, or a
 * PPTX core that exports no blueprints yet, answers `undefined` and the caller
 * degrades to "none", never to a dead server.
 */

import { createRequire } from 'module';
import { pathToFileURL } from 'url';

import type { Blueprint, BlueprintFillEntry } from '@json-to-office/shared';

import type { FormatName } from './adapters.js';

const CORE_SPECIFIERS: Record<FormatName, string> = {
  docx: '@json-to-office/core-docx',
  pptx: '@json-to-office/core-pptx',
};

/** What each core is asked for, by the name it exports it under. */
const CORE_EXPORTS: Record<
  FormatName,
  { themes: string; blueprints?: string; instantiate?: string }
> = {
  docx: {
    themes: 'themes',
    blueprints: 'DOCX_BLUEPRINTS',
    instantiate: 'instantiateDocxBlueprint',
  },
  pptx: { themes: 'pptxThemes' },
};

export interface InstantiateOptions {
  variant?: string;
  theme?: string;
  definitions: Readonly<Record<string, unknown>>;
}

export interface Instantiated {
  document: Record<string, unknown>;
  fillMap: BlueprintFillEntry[];
  variant: string;
}

export interface LoadedCore {
  /** Built-in theme names, sorted. */
  themeNames: string[];
  /** Bundled blueprints by id; empty for a core that ships none. */
  blueprints: Readonly<Record<string, Blueprint>>;
  /** Instantiate a blueprint; absent for a core that ships none. */
  instantiate?: (
    blueprint: Blueprint,
    options: InstantiateOptions
  ) => Instantiated;
}

let resolver: NodeJS.Require | undefined;
try {
  const here = createRequire(import.meta.url);
  resolver = createRequire(
    here.resolve('@json-to-office/jto-ops/package.json')
  );
} catch {
  /* jto-ops unresolvable: every core answers undefined */
}

const memo = new Map<FormatName, Promise<LoadedCore | undefined>>();

/** The core of a format, or undefined when it cannot be loaded here. */
export function loadCore(format: FormatName): Promise<LoadedCore | undefined> {
  let pending = memo.get(format);
  if (!pending) {
    pending = load(format);
    memo.set(format, pending);
  }
  return pending;
}

async function load(format: FormatName): Promise<LoadedCore | undefined> {
  if (!resolver) return undefined;
  try {
    const core = (await import(
      pathToFileURL(resolver.resolve(CORE_SPECIFIERS[format])).href
    )) as Record<string, unknown>;
    const names = CORE_EXPORTS[format];
    const themes = (core[names.themes] ?? {}) as Record<string, unknown>;
    const blueprints = (
      names.blueprints ? core[names.blueprints] ?? {} : {}
    ) as Record<string, Blueprint>;
    const instantiate = names.instantiate
      ? (core[names.instantiate] as LoadedCore['instantiate'])
      : undefined;
    return {
      themeNames: Object.keys(themes).sort(),
      blueprints,
      ...(instantiate && { instantiate }),
    };
  } catch {
    return undefined;
  }
}
