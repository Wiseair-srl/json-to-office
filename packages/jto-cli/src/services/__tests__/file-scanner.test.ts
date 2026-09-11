/**
 * Discovery skips test data and core-docx's bundled examples. The hosted
 * playground scans the monorepo root, and listed regression fixtures and the
 * library examples beside the templates.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { FileSystemScanner } from '../file-scanner.js';

const TEMPLATE = 'packages/jto/src/client/public/templates/annual.docx.json';

const FILES = [
  'report.docx.json',
  TEMPLATE,
  'packages/design-evals/src/__fixtures__/regressions/fixture.docx.json',
  'packages/core-docx/src/__tests__/case.docx.json',
  'packages/core-docx/src/templates/documents/example.docx.json',
];

describe('FileSystemScanner exclusions', () => {
  let root: string;

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(process.cwd(), '.tmp-scanner-'));
    await fs.writeFile(path.join(root, 'package.json'), '{}');
    for (const file of FILES) {
      await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await fs.writeFile(path.join(root, file), '{}');
    }
  });

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  // Posix separators whatever the host: the fixtures above are written that
  // way, and `path.relative` answers with backslashes on Windows.
  const relative = (files: string[]) =>
    [
      ...new Set(
        files.map((file) => path.relative(root, file).split(path.sep).join('/'))
      ),
    ].sort();

  it('the depth scan skips them', async () => {
    const found = await new FileSystemScanner().scan(root, 'docx-document');
    expect(relative(found)).toEqual([TEMPLATE, 'report.docx.json']);
  });

  it('the monorepo scan skips them', async () => {
    const found = await new FileSystemScanner().scanMonorepoLocations(
      root,
      'docx-document'
    );
    expect(relative(found)).toEqual([TEMPLATE]);
  });
});
