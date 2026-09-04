/**
 * Loading a skill, which is a bundle and not a file.
 *
 * The assisted baseline is the programme's ceiling. Measuring it from
 * `SKILL.md` alone captures the workflow and none of the taste documents it
 * refers to — roughly 18 KB of a 94 KB skill — and understating a ceiling
 * makes every later phase look better than it is.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { loadSkill, SkillError } from './skill.js';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jto-skill-'));
  await fs.mkdir(path.join(dir, 'assets', 'taste'), { recursive: true });
  await fs.mkdir(path.join(dir, 'scripts', '__pycache__'), { recursive: true });
  await fs.writeFile(path.join(dir, 'SKILL.md'), '# How to work');
  await fs.writeFile(
    path.join(dir, 'assets', 'taste', 'typography.md'),
    '# Typography'
  );
  await fs.writeFile(
    path.join(dir, 'assets', 'taste', 'tables.md'),
    '# Tables'
  );
  await fs.writeFile(path.join(dir, 'scripts', 'preflight.py'), 'print(1)');
  await fs.writeFile(
    path.join(dir, 'scripts', '__pycache__', 'cached.md'),
    'generated'
  );
  await fs.writeFile(
    path.join(dir, 'manifest.json'),
    JSON.stringify({ name: 'json-to-office', version: '3.1.0' })
  );
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('loadSkill', () => {
  it('carries every Markdown document, not just SKILL.md', async () => {
    const skill = await loadSkill(dir);
    expect(skill.mode).toBe('bundle');
    expect(skill.files).toContain('assets/taste/typography.md');
    expect(skill.files).toContain('assets/taste/tables.md');
    expect(skill.text).toContain('# Typography');
    expect(skill.text).toContain('# Tables');
  });

  it('puts SKILL.md first — it frames every other document', async () => {
    const skill = await loadSkill(dir);
    expect(skill.files[0]).toBe('SKILL.md');
    expect(skill.text.indexOf('# How to work')).toBeLessThan(
      skill.text.indexOf('# Typography')
    );
  });

  it('names each document, so the agent knows what it is reading', async () => {
    const skill = await loadSkill(dir);
    expect(skill.text).toContain('<skill-file path="assets/taste/tables.md">');
  });

  it('reads the name and version from the manifest', async () => {
    const skill = await loadSkill(dir);
    expect(skill).toMatchObject({ name: 'json-to-office', version: '3.1.0' });
  });

  it('leaves out generated and non-prose files', async () => {
    const skill = await loadSkill(dir);
    expect(skill.files.join(' ')).not.toContain('__pycache__');
    expect(skill.files.join(' ')).not.toContain('preflight.py');
  });

  it('leaves out release notes, which are Markdown and not guidance', async () => {
    await fs.writeFile(path.join(dir, 'CHANGELOG.md'), '# 3.1.0');
    const skill = await loadSkill(dir);
    expect(skill.files).not.toContain('CHANGELOG.md');
  });

  it('hashes the same bundle the same way twice', async () => {
    const [a, b] = [await loadSkill(dir), await loadSkill(dir)];
    expect(a.hash).toBe(b.hash);
    expect(a.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('marks a single file as the partial thing it is', async () => {
    const skill = await loadSkill(path.join(dir, 'SKILL.md'));
    expect(skill.mode).toBe('file');
    expect(skill.files).toEqual(['SKILL.md']);
    expect(skill.text).not.toContain('# Typography');
  });

  it('refuses a directory that is not a skill', async () => {
    await fs.rm(path.join(dir, 'SKILL.md'));
    await expect(loadSkill(dir)).rejects.toThrow(SkillError);
  });

  it('says where it looked when there is nothing there', async () => {
    await expect(loadSkill('/nowhere/at/all')).rejects.toThrow(/\/nowhere/);
  });
});
