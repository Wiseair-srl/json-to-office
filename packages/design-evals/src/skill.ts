/**
 * Loading a skill for an assisted run.
 *
 * A skill is not a file. `json-to-office` 3.1.0 is an 18 KB `SKILL.md` plus
 * roughly 76 KB of taste and reference documents the agent reads on demand —
 * typography, layout, chart design, tables, gotchas, two cheatsheets. The
 * first version of this took a single path, read it, and appended it to the
 * system prompt, which measured the workflow instructions and none of the
 * taste. The assisted baseline is the programme's *ceiling*: understating it
 * makes every later phase look better than it is, which is the one direction
 * an eval must never be wrong in.
 *
 * So a skill is loaded as a bundle: `SKILL.md` first, then every Markdown
 * document under it, each under a header naming its path.
 *
 * This is an approximation, and the honest name for what it is not: real skill
 * loading is progressive — the agent decides what to open, and pays attention
 * accordingly. Inlining the whole bundle puts everything in front of it at
 * once. That is generous rather than stingy, which is the right way round for
 * a ceiling, and the manifest records `skillMode` so no one reads the result
 * as a measurement of skill loading itself.
 */

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface LoadedSkill {
  /** Everything the agent is given, as one string. */
  text: string;
  /** Skill name, from the bundle's manifest or its directory. */
  name: string;
  /** Version from `manifest.json`, when the bundle has one. */
  version: string;
  /** Files included, repo-relative to the bundle root, in order. */
  files: string[];
  /** SHA-256 over the concatenated bundle — what the manifest pins. */
  hash: string;
  /** `bundle` when a directory was inlined; `file` for a single document. */
  mode: 'bundle' | 'file';
  /**
   * What the bundle contains but the prompt does not: templates, scripts,
   * media. A skill that ships a template library and a preflight script does
   * part of its work through them, and an assisted run with no file tools
   * cannot. Recorded so the ceiling is read as the ceiling of the skill's
   * *guidance*, which is what this programme is actually trying to replace.
   */
  excluded: { files: number; bytes: number };
}

export class SkillError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SkillError';
  }
}

/** Every Markdown file under `root`, depth-first, in stable order. */
async function markdownFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of [...entries].sort((a, b) =>
      a.name.localeCompare(b.name)
    )) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Nothing executable or generated: a skill's prose is the payload.
        if (entry.name === '__pycache__' || entry.name === 'node_modules') {
          continue;
        }
        await walk(full);
      } else if (
        entry.name.toLowerCase().endsWith('.md') &&
        // Release notes are Markdown and are not guidance; putting them in
        // front of the author is noise in a context window that has a budget.
        entry.name.toUpperCase() !== 'CHANGELOG.MD'
      ) {
        found.push(full);
      }
    }
  };
  await walk(root);
  return found;
}

/**
 * Read a skill from a directory (preferred) or a single Markdown file.
 *
 * A single file is accepted because it is sometimes what exists, but it is
 * reported as `mode: 'file'` so a scorecard built on one is identifiable: it
 * carried the workflow and not the taste.
 */
export async function loadSkill(target: string): Promise<LoadedSkill> {
  let stat;
  try {
    stat = await fs.stat(target);
  } catch {
    throw new SkillError(`No skill at ${target}.`);
  }

  if (stat.isFile()) {
    const text = await fs.readFile(target, 'utf8');
    return {
      text,
      name: path.basename(path.dirname(target)),
      version: 'unknown',
      files: [path.basename(target)],
      hash: createHash('sha256').update(text).digest('hex'),
      mode: 'file',
      excluded: { files: 0, bytes: 0 },
    };
  }

  const entry = path.join(target, 'SKILL.md');
  try {
    await fs.access(entry);
  } catch {
    throw new SkillError(`${target} has no SKILL.md, so it is not a skill.`);
  }

  // SKILL.md first — it is the document that frames every other one — then the
  // rest in a stable order so two runs of the same bundle hash the same.
  const rest = (await markdownFiles(target)).filter((file) => file !== entry);
  const ordered = [entry, ...rest];

  const parts: string[] = [];
  for (const file of ordered) {
    const relative = path.relative(target, file);
    parts.push(
      `<skill-file path="${relative}">\n${await fs.readFile(file, 'utf8').then((t) => t.trim())}\n</skill-file>`
    );
  }
  const text = parts.join('\n\n');

  let name = path.basename(target);
  let version = 'unknown';
  try {
    const manifest = JSON.parse(
      await fs.readFile(path.join(target, 'manifest.json'), 'utf8')
    ) as { name?: string; version?: string };
    if (manifest.name) name = manifest.name;
    if (manifest.version) version = manifest.version;
  } catch {
    // A bundle without a manifest is still a skill; it just cannot say which.
  }

  const included = new Set(ordered);
  let excludedFiles = 0;
  let excludedBytes = 0;
  const measure = async (dir: string): Promise<void> => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await measure(full);
      else if (!included.has(full)) {
        excludedFiles += 1;
        excludedBytes += (await fs.stat(full)).size;
      }
    }
  };
  await measure(target);

  return {
    text,
    name,
    version,
    files: ordered.map((file) => path.relative(target, file)),
    hash: createHash('sha256').update(text).digest('hex'),
    mode: 'bundle',
    excluded: { files: excludedFiles, bytes: excludedBytes },
  };
}
