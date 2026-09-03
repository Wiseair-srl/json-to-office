import { describe, expect, it, beforeAll } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  ARCHETYPES,
  CorpusError,
  developmentCorpusDir,
  loadCorpus,
  parseBrief,
  selectBriefs,
  stratify,
  type Corpus,
} from './corpus.js';

const BRIEF = `---
id: sample-brief
format: docx
archetype: client-report
language: en
density: medium
title: A sample brief
---

Write a short report about something measurable.
`;

describe('parseBrief', () => {
  it('reads the frontmatter and hashes the body', () => {
    const brief = parseBrief(BRIEF, '/tmp/sample-brief.md');
    expect(brief).toMatchObject({
      id: 'sample-brief',
      format: 'docx',
      archetype: 'client-report',
      language: 'en',
      density: 'medium',
      title: 'A sample brief',
      text: 'Write a short report about something measurable.',
    });
    expect(brief.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('refuses a brief whose id and filename disagree', () => {
    // `--briefs` addresses a brief by id; a filename saying otherwise makes
    // the selector lie about what ran.
    expect(() => parseBrief(BRIEF, '/tmp/other-name.md')).toThrow(CorpusError);
  });

  it('names the missing field rather than failing vaguely', () => {
    const without = BRIEF.replace('density: medium\n', '');
    expect(() => parseBrief(without, '/tmp/sample-brief.md')).toThrow(
      /missing "density"/
    );
  });

  it('rejects a value outside the vocabulary', () => {
    const wrong = BRIEF.replace('archetype: client-report', 'archetype: essay');
    expect(() => parseBrief(wrong, '/tmp/sample-brief.md')).toThrow(
      /expected one of/
    );
  });

  it('refuses an empty body', () => {
    const empty = BRIEF.slice(0, BRIEF.indexOf('Write'));
    expect(() => parseBrief(empty, '/tmp/sample-brief.md')).toThrow(
      CorpusError
    );
  });
});

describe('the committed development corpus', () => {
  let corpus: Corpus;

  beforeAll(async () => {
    corpus = await loadCorpus(developmentCorpusDir());
  });

  it('holds 40 briefs, 24 docx and 16 pptx', () => {
    expect(corpus.briefs).toHaveLength(40);
    expect(corpus.stratification.byFormat).toEqual({ docx: 24, pptx: 16 });
  });

  it('covers every archetype and carries language metadata', () => {
    for (const archetype of ARCHETYPES) {
      expect(
        corpus.stratification.byArchetype[archetype],
        archetype
      ).toBeGreaterThan(0);
    }
    expect(Object.keys(corpus.stratification.byLanguage)).toContain('en');
  });

  it('varies data density, so the corpus is not all one shape', () => {
    for (const density of ['low', 'medium', 'high']) {
      expect(corpus.stratification.byDensity[density], density).toBeGreaterThan(
        0
      );
    }
  });

  it('identifies itself with a stable hash over its briefs', () => {
    expect(corpus.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('gives every brief enough to author from', () => {
    for (const brief of corpus.briefs) {
      expect(brief.text.split(/\s+/).length, brief.id).toBeGreaterThan(40);
      expect(brief.title.length, brief.id).toBeGreaterThan(10);
    }
  });
});

describe('selectBriefs', () => {
  const corpus = {
    kind: 'development' as const,
    directory: '/tmp/corpus',
    hash: 'x',
    stratification: stratify([]),
    briefs: ['a', 'b', 'c'].map((id) => ({
      id,
      format: 'docx' as const,
      archetype: 'client-report' as const,
      language: 'en',
      density: 'low' as const,
      title: id,
      text: id,
      hash: id,
    })),
  };

  it('returns everything when nothing is selected', () => {
    expect(selectBriefs(corpus, undefined)).toHaveLength(3);
    expect(selectBriefs(corpus, '  ')).toHaveLength(3);
  });

  it('keeps corpus order regardless of how the selector is written', () => {
    expect(selectBriefs(corpus, 'c, a').map((brief) => brief.id)).toEqual([
      'a',
      'c',
    ]);
  });

  it('stops on an unknown id rather than measuring nothing', () => {
    expect(() => selectBriefs(corpus, 'a,typo')).toThrow(/"typo"/);
  });
});

describe('loadCorpus', () => {
  it('says where it looked when the directory is not there', async () => {
    await expect(loadCorpus('/nowhere/at/all')).rejects.toThrow(
      /\/nowhere\/at\/all/
    );
  });

  it('refuses an empty directory instead of scoring zero briefs', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jto-evals-'));
    await expect(loadCorpus(dir)).rejects.toThrow(/No \.md briefs/);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('reads a sealed corpus exactly as it reads the committed one', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jto-evals-sealed-'));
    await fs.writeFile(path.join(dir, 'sample-brief.md'), BRIEF);
    const sealed = await loadCorpus(dir, 'sealed');
    expect(sealed.kind).toBe('sealed');
    expect(sealed.briefs[0].id).toBe('sample-brief');
    await fs.rm(dir, { recursive: true, force: true });
  });
});
