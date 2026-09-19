/**
 * Every PNG and JPEG written inline in the repository's sources decodes.
 *
 * The block matrix's image and twenty-odd test fixtures once shared one
 * corrupt PNG literal: its header read fine, so every size assertion passed,
 * while Word and PowerPoint showed "The picture can't be displayed" and
 * LibreOffice drew nothing. Nothing that sizes an image reads past the
 * header, so nothing noticed. This reads every inline image in
 * `packages/<name>/src` with the same check generation applies, so a
 * fixture that would not decode cannot come back.
 *
 * A literal cut off with `...` is a placeholder in prose or a parsing test,
 * not an image, and is skipped. So is one a test damages on purpose to prove
 * it is refused: the comment just above it has to say `corrupt on purpose`.
 */

import { readdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { imageIntegrityDefect } from '@json-to-office/shared/images/node';

const PACKAGES = fileURLToPath(new URL('../..', import.meta.url));
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json']);

/**
 * A base64 PNG or JPEG run (the base64 of each signature), and whether an
 * ellipsis follows it. Assembled so this file does not match itself.
 */
const INLINE_IMAGE = new RegExp(
  `(${'iVBORw0K' + 'Ggo'}|${'\\/9j' + '\\/'})[A-Za-z0-9+/]*={0,2}(\\.\\.\\.)?`,
  'g'
);

/** How far above a literal its `corrupt on purpose` comment may sit. */
const WAIVER_LINES = 3;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (EXTENSIONS.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

interface InlineImage {
  where: string;
  base64: string;
}

function inlineImages(): InlineImage[] {
  const found: InlineImage[] = [];
  for (const pkg of readdirSync(PACKAGES, { withFileTypes: true })) {
    const src = path.join(PACKAGES, pkg.name, 'src');
    if (!pkg.isDirectory()) continue;
    let files: string[];
    try {
      files = sourceFiles(src);
    } catch {
      continue;
    }
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(INLINE_IMAGE)) {
        if (match[2]) continue;
        // `/9j/` also turns up inside unrelated base64; only a run long enough
        // to be an image is one.
        if (match[1] === '/9j/' && match[0].length < 64) continue;
        const before = text.slice(0, match.index).split(/\r?\n/);
        const line = before.length;
        const context = before.slice(-1 - WAIVER_LINES).join('\n');
        if (context.includes('corrupt on purpose')) continue;
        found.push({
          where: `${path.relative(PACKAGES, file).split(path.sep).join('/')}:${line}`,
          base64: match[0],
        });
      }
    }
  }
  return found;
}

describe('inline images in source', () => {
  const images = inlineImages();

  it('finds the fixtures it is meant to guard', () => {
    // The block matrix image and the corpus fixtures, at the least.
    expect(images.length).toBeGreaterThan(30);
    expect(
      images.some((i) => i.where.startsWith('jto-ops/src/block-matrix.ts'))
    ).toBe(true);
  });

  it('decodes every one of them', () => {
    const broken = images
      .map(({ where, base64 }) => {
        const defect = imageIntegrityDefect(Buffer.from(base64, 'base64'));
        return defect ? `${where}: ${defect}` : undefined;
      })
      .filter((entry): entry is string => entry !== undefined);
    expect(broken).toEqual([]);
  });
});
