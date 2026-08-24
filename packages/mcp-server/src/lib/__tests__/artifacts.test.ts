import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import {
  deliverArtifact,
  MAX_INLINE_ARTIFACT_BYTES,
  MIME_TYPES,
} from '../artifacts.js';
import { createOutputRoot } from '../output-root.js';
import { ERROR_CODES } from '../errors.js';

let scratch: string;

beforeEach(async () => {
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'jto-mcp-test-'));
});

afterEach(async () => {
  await fs.rm(scratch, { recursive: true, force: true });
});

const docxMime = MIME_TYPES['.docx'];

function root() {
  return createOutputRoot({ flagDir: path.join(scratch, 'out') });
}

describe('deliverArtifact', () => {
  it('writes to the output root by default', async () => {
    const buffer = Buffer.from('PK pretend docx');
    const result = await deliverArtifact(buffer, {
      filename: 'report.docx',
      mimeType: docxMime,
      outputRoot: root(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifact.mode).toBe('path');
    if (result.artifact.mode !== 'path') return;
    expect(result.artifact.bytes).toBe(buffer.byteLength);
    expect(result.artifact.mimeType).toBe(docxMime);
    await expect(fs.readFile(result.artifact.path)).resolves.toEqual(buffer);
  });

  it('inlines base64 under the limit', async () => {
    const buffer = Buffer.from('small');
    const result = await deliverArtifact(buffer, {
      filename: 'report.docx',
      mimeType: docxMime,
      mode: 'base64',
      outputRoot: root(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok || result.artifact.mode !== 'base64') return;
    expect(Buffer.from(result.artifact.base64, 'base64')).toEqual(buffer);
    expect(result.artifact.bytes).toBe(buffer.byteLength);
  });

  it('refuses base64 over the limit instead of quietly writing a file', async () => {
    const outputRoot = root();
    const buffer = Buffer.alloc(64);
    const result = await deliverArtifact(buffer, {
      filename: 'report.docx',
      mimeType: docxMime,
      mode: 'base64',
      maxInlineBytes: 8,
      outputRoot,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0].code).toBe(ERROR_CODES.ARTIFACT_TOO_LARGE);
    expect(result.diagnostics[0].suggestion).toMatch(/path/);
    await expect(fs.access(outputRoot.path)).rejects.toThrow();
  });

  it('refuses a filename that escapes the output root', async () => {
    const result = await deliverArtifact(Buffer.from('x'), {
      filename: '../escaped.docx',
      mimeType: docxMime,
      outputRoot: root(),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0].code).toBe(ERROR_CODES.OUTPUT_ROOT_ESCAPE);
    await expect(
      fs.access(path.join(scratch, 'escaped.docx'))
    ).rejects.toThrow();
  });

  it('does not write through a symlink named as the artifact', async () => {
    const outside = path.join(scratch, 'outside');
    const rootPath = path.join(scratch, 'out');
    await fs.mkdir(outside, { recursive: true });
    await fs.mkdir(rootPath, { recursive: true });
    const victim = path.join(outside, 'victim.txt');
    await fs.writeFile(victim, 'original');
    await fs.symlink(victim, path.join(rootPath, 'report.docx'), 'file');

    const result = await deliverArtifact(Buffer.from('PK pretend docx'), {
      filename: 'report.docx',
      mimeType: docxMime,
      outputRoot: createOutputRoot({ flagDir: rootPath }),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0].code).toBe(ERROR_CODES.OUTPUT_ROOT_ESCAPE);
    await expect(fs.readFile(victim, 'utf8')).resolves.toBe('original');
  });

  it('refuses a link planted between resolution and the write', async () => {
    const outside = path.join(scratch, 'outside');
    const rootPath = path.join(scratch, 'out');
    await fs.mkdir(outside, { recursive: true });
    await fs.mkdir(rootPath, { recursive: true });
    const victim = path.join(outside, 'victim.txt');
    await fs.writeFile(victim, 'original');

    // Stand in for the race: a root that hands back a clean in-root path which
    // has become a symlink by the time deliverArtifact opens it.
    const inRoot = path.join(rootPath, 'report.docx');
    const outputRoot = {
      ...createOutputRoot({ flagDir: rootPath }),
      async resolveOutputPath() {
        await fs.symlink(victim, inRoot, 'file');
        return { ok: true as const, path: inRoot, relative: 'report.docx' };
      },
    };

    const result = await deliverArtifact(Buffer.from('PK pretend docx'), {
      filename: 'report.docx',
      mimeType: docxMime,
      outputRoot,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0].code).toBe(ERROR_CODES.OUTPUT_ROOT_ESCAPE);
    await expect(fs.readFile(victim, 'utf8')).resolves.toBe('original');
  });

  it('defaults the inline limit to 4 MiB', () => {
    expect(MAX_INLINE_ARTIFACT_BYTES).toBe(4 * 1024 * 1024);
  });
});
