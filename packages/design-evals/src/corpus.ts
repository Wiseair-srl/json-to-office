/**
 * The brief corpus, on disk.
 *
 * A brief is a Markdown file with a small frontmatter block: what the document
 * is for, and enough metadata to stratify a scorecard by archetype, format and
 * language. Files rather than one table so that a *sealed* corpus is a
 * drop-in directory — the acceptance set is supplied from outside the repo,
 * and nothing about reading it may differ from reading the committed one.
 *
 * Sealing is a property of the corpus, not of a brief: a sealed corpus keeps
 * its text out of every artifact this package writes, so a result can be
 * published without publishing the questions.
 */

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export type BriefFormat = 'docx' | 'pptx';

/** The archetypes v1 aims at; a brief names the one it is written for. */
export const ARCHETYPES = [
  'client-report',
  'technical-report',
  'consulting-deck',
] as const;
export type Archetype = (typeof ARCHETYPES)[number];

/** How much of the brief is numbers the document has to display. */
export const DENSITIES = ['low', 'medium', 'high'] as const;
export type Density = (typeof DENSITIES)[number];

export interface Brief {
  id: string;
  format: BriefFormat;
  archetype: Archetype;
  language: string;
  density: Density;
  title: string;
  /** The prompt body, verbatim. */
  text: string;
  /** SHA-256 of the body, which identifies a brief without disclosing it. */
  hash: string;
}

export interface Corpus {
  /** `development` is committed and may be tuned against; `sealed` may not. */
  kind: 'development' | 'sealed';
  directory: string;
  briefs: Brief[];
  /** SHA-256 over every brief hash, in id order: the corpus's identity. */
  hash: string;
  /** Counts by format, archetype, language and density. */
  stratification: Stratification;
}

export interface Stratification {
  total: number;
  byFormat: Record<string, number>;
  byArchetype: Record<string, number>;
  byLanguage: Record<string, number>;
  byDensity: Record<string, number>;
}

export class CorpusError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CorpusError';
  }
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function requireField(
  fields: Record<string, string>,
  name: string,
  file: string
): string {
  const value = fields[name];
  if (value === undefined || value.trim() === '') {
    throw new CorpusError(`${file}: frontmatter is missing "${name}".`);
  }
  return value.trim();
}

function oneOf<T extends string>(
  value: string,
  allowed: readonly T[],
  name: string,
  file: string
): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new CorpusError(
      `${file}: ${name} is "${value}"; expected one of ${allowed.join(', ')}.`
    );
  }
  return value as T;
}

export function parseBrief(source: string, file: string): Brief {
  const found = FRONTMATTER.exec(source);
  if (!found) {
    throw new CorpusError(`${file}: no frontmatter block.`);
  }
  const fields: Record<string, string> = {};
  for (const line of found[1].split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    fields[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  const text = source.slice(found[0].length).trim();
  if (text === '') throw new CorpusError(`${file}: the brief body is empty.`);

  const id = requireField(fields, 'id', file);
  const expected = path.basename(file).replace(/\.md$/, '');
  if (id !== expected) {
    // A brief is addressed by id on the command line; a filename that says
    // something else makes `--briefs` lie about what ran.
    throw new CorpusError(`${file}: id "${id}" does not match the filename.`);
  }

  return {
    id,
    format: oneOf(
      requireField(fields, 'format', file),
      ['docx', 'pptx'] as const,
      'format',
      file
    ),
    archetype: oneOf(
      requireField(fields, 'archetype', file),
      ARCHETYPES,
      'archetype',
      file
    ),
    language: requireField(fields, 'language', file),
    density: oneOf(
      requireField(fields, 'density', file),
      DENSITIES,
      'density',
      file
    ),
    title: requireField(fields, 'title', file),
    text,
    hash: createHash('sha256').update(text).digest('hex'),
  };
}

function count(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort());
}

export function stratify(briefs: readonly Brief[]): Stratification {
  return {
    total: briefs.length,
    byFormat: count(briefs.map((brief) => brief.format)),
    byArchetype: count(briefs.map((brief) => brief.archetype)),
    byLanguage: count(briefs.map((brief) => brief.language)),
    byDensity: count(briefs.map((brief) => brief.density)),
  };
}

/** The directory the committed development briefs live in. */
export function developmentCorpusDir(): string {
  return path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    '../briefs'
  );
}

export async function loadCorpus(
  directory: string,
  kind: Corpus['kind'] = 'development'
): Promise<Corpus> {
  let names: string[];
  try {
    names = (await fs.readdir(directory)).filter((name) =>
      name.endsWith('.md')
    );
  } catch (error) {
    throw new CorpusError(
      `Cannot read the corpus at ${directory}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  if (names.length === 0) {
    throw new CorpusError(`No .md briefs in ${directory}.`);
  }

  const briefs: Brief[] = [];
  for (const name of names.sort()) {
    const file = path.join(directory, name);
    briefs.push(parseBrief(await fs.readFile(file, 'utf8'), file));
  }
  briefs.sort((a, b) => a.id.localeCompare(b.id));

  const duplicate = briefs.find(
    (brief, index) => index > 0 && briefs[index - 1].id === brief.id
  );
  if (duplicate) throw new CorpusError(`Duplicate brief id "${duplicate.id}".`);

  return {
    kind,
    directory,
    briefs,
    hash: createHash('sha256')
      .update(briefs.map((brief) => `${brief.id}:${brief.hash}`).join('\n'))
      .digest('hex'),
    stratification: stratify(briefs),
  };
}

/**
 * The briefs a `--briefs` selector names, in corpus order.
 *
 * An unknown id is an error rather than an empty run: a typo that silently
 * measures nothing is worse than one that stops.
 */
export function selectBriefs(
  corpus: Corpus,
  selector: string | undefined
): Brief[] {
  if (selector === undefined || selector.trim() === '') return corpus.briefs;
  const wanted = selector
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  const known = new Map(corpus.briefs.map((brief) => [brief.id, brief]));
  const missing = wanted.filter((id) => !known.has(id));
  if (missing.length > 0) {
    throw new CorpusError(
      `No brief with id ${missing.map((id) => `"${id}"`).join(', ')} in ${
        corpus.directory
      }.`
    );
  }
  return corpus.briefs.filter((brief) => wanted.includes(brief.id));
}
