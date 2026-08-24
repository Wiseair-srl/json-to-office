import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import {
  checkOutputName,
  createOutputRoot,
  OUTPUT_DIR_ENV,
} from '../output-root.js';
import { ERROR_CODES } from '../errors.js';

let scratch: string;

beforeEach(async () => {
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'jto-mcp-test-'));
});

afterEach(async () => {
  await fs.rm(scratch, { recursive: true, force: true });
});

describe('root resolution precedence', () => {
  it('prefers --output-dir over the env var', () => {
    const root = createOutputRoot({
      flagDir: path.join(scratch, 'flag'),
      env: { [OUTPUT_DIR_ENV]: path.join(scratch, 'env') },
    });
    expect(root.path).toBe(path.join(scratch, 'flag'));
    expect(root.ephemeral).toBe(false);
  });

  it('falls back to the env var', () => {
    const root = createOutputRoot({
      env: { [OUTPUT_DIR_ENV]: path.join(scratch, 'env') },
    });
    expect(root.path).toBe(path.join(scratch, 'env'));
    expect(root.ephemeral).toBe(false);
  });

  it('falls back to a per-connection temp directory', () => {
    const root = createOutputRoot({ env: {}, tmpDir: scratch });
    expect(root.path.startsWith(path.join(scratch, 'jto-mcp-'))).toBe(true);
    expect(root.ephemeral).toBe(true);
  });

  it('does not create the root until first use', async () => {
    const root = createOutputRoot({ env: {}, tmpDir: scratch });
    await expect(fs.access(root.path)).rejects.toThrow();
    await root.ensure();
    await expect(fs.access(root.path)).resolves.toBeUndefined();
  });
});

describe('checkOutputName', () => {
  const rejected = [
    ['empty', ''],
    ['whitespace', '   '],
    ['NUL', 'a\0b.docx'],
    ['posix absolute', '/etc/passwd'],
    ['windows absolute', 'C:\\Windows\\system32\\x.docx'],
    ['drive relative', 'C:report.docx'],
    ['parent traversal', '../escaped.docx'],
    ['nested traversal', 'sub/../../escaped.docx'],
    ['backslash traversal', 'sub\\..\\..\\escaped.docx'],
  ] as const;

  for (const [label, name] of rejected) {
    it(`rejects ${label}`, () => {
      const result = checkOutputName(name);
      expect(result?.ok).toBe(false);
      expect(result?.diagnostics[0].code).toBe(ERROR_CODES.OUTPUT_ROOT_ESCAPE);
    });
  }

  it('accepts a plain name and a nested one', () => {
    expect(checkOutputName('report.docx')).toBeUndefined();
    expect(checkOutputName('nested/report.docx')).toBeUndefined();
  });
});

describe('resolveOutputPath', () => {
  it('resolves inside the root and creates parents', async () => {
    const root = createOutputRoot({ flagDir: path.join(scratch, 'out') });
    const resolved = await root.resolveOutputPath('nested/deep/report.docx');
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.relative).toBe(path.join('nested', 'deep', 'report.docx'));
    await expect(
      fs.access(path.dirname(resolved.path))
    ).resolves.toBeUndefined();
  });

  it('refuses traversal without touching the filesystem', async () => {
    const root = createOutputRoot({ flagDir: path.join(scratch, 'out') });
    const resolved = await root.resolveOutputPath('../outside.docx');
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.diagnostics[0].code).toBe(ERROR_CODES.OUTPUT_ROOT_ESCAPE);
  });

  it('refuses a path that leaves the root through a symlink', async () => {
    const outside = path.join(scratch, 'outside');
    const rootPath = path.join(scratch, 'out');
    await fs.mkdir(outside, { recursive: true });
    await fs.mkdir(rootPath, { recursive: true });
    await fs.symlink(outside, path.join(rootPath, 'escape'), 'dir');

    const root = createOutputRoot({ flagDir: rootPath });
    const resolved = await root.resolveOutputPath('escape/report.docx');
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.diagnostics[0].code).toBe(ERROR_CODES.OUTPUT_ROOT_ESCAPE);
    // The write never happened, so nothing landed outside the root.
    await expect(
      fs.access(path.join(outside, 'report.docx'))
    ).rejects.toThrow();
  });

  it('creates nothing outside the root on the way to refusing', async () => {
    const outside = path.join(scratch, 'outside');
    const rootPath = path.join(scratch, 'out');
    await fs.mkdir(outside, { recursive: true });
    await fs.mkdir(rootPath, { recursive: true });
    await fs.symlink(outside, path.join(rootPath, 'escape'), 'dir');

    const root = createOutputRoot({ flagDir: rootPath });
    const resolved = await root.resolveOutputPath(
      'escape/nested/deep/report.docx'
    );
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.diagnostics[0].code).toBe(ERROR_CODES.OUTPUT_ROOT_ESCAPE);
    // A refusal that still made `<outside>/nested` is a write outside the root
    // by another name: the caller chose where those directories landed.
    await expect(fs.readdir(outside)).resolves.toEqual([]);
  });

  it('refuses when the artifact name itself is a symlink out of the root', async () => {
    const outside = path.join(scratch, 'outside');
    const rootPath = path.join(scratch, 'out');
    await fs.mkdir(outside, { recursive: true });
    await fs.mkdir(rootPath, { recursive: true });
    const victim = path.join(outside, 'victim.txt');
    await fs.writeFile(victim, 'original');
    // Only the leaf is a link, so realpathing the parent alone cannot see it.
    await fs.symlink(victim, path.join(rootPath, 'report.docx'), 'file');

    const root = createOutputRoot({ flagDir: rootPath });
    const resolved = await root.resolveOutputPath('report.docx');
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.diagnostics[0].code).toBe(ERROR_CODES.OUTPUT_ROOT_ESCAPE);
    await expect(fs.readFile(victim, 'utf8')).resolves.toBe('original');
  });

  it('follows a leaf symlink that stays inside the root, reporting the real path', async () => {
    const rootPath = path.join(scratch, 'out');
    await fs.mkdir(path.join(rootPath, 'real'), { recursive: true });
    const target = path.join(rootPath, 'real', 'target.docx');
    await fs.writeFile(target, 'x');
    await fs.symlink(target, path.join(rootPath, 'report.docx'), 'file');

    const root = createOutputRoot({ flagDir: rootPath });
    const resolved = await root.resolveOutputPath('report.docx');
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.path).toBe(await fs.realpath(target));
    expect(resolved.relative).toBe(path.join('real', 'target.docx'));
  });

  it('tolerates a root that is itself reached through a symlink', async () => {
    const real = path.join(scratch, 'real-root');
    const link = path.join(scratch, 'linked-root');
    await fs.mkdir(real, { recursive: true });
    await fs.symlink(real, link, 'dir');

    const root = createOutputRoot({ flagDir: link });
    const resolved = await root.resolveOutputPath('report.docx');
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.path).toBe(
      path.join(await fs.realpath(real), 'report.docx')
    );
  });
});

describe('dispose', () => {
  it('removes an ephemeral root', async () => {
    const root = createOutputRoot({ env: {}, tmpDir: scratch });
    await root.ensure();
    await root.dispose();
    await expect(fs.access(root.path)).rejects.toThrow();
  });

  it('leaves a configured root alone', async () => {
    const root = createOutputRoot({ flagDir: path.join(scratch, 'keep') });
    await root.ensure();
    await root.dispose();
    await expect(fs.access(root.path)).resolves.toBeUndefined();
  });
});
