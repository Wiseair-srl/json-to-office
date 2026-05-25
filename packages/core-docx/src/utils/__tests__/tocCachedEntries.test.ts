/**
 * Tests for the auto-injecting TOC cached-entries pre-pass.
 * Exercises injectTocCachedEntries through processDocument so we cover
 * the same path the generator runs in production.
 */

import { describe, it, expect } from 'vitest';
import { processDocument } from '../../core/structure';
import {
  createMockTheme,
  TEST_THEME_NAME,
} from '../../components/__tests__/helpers';
import type { ReportComponentDefinition } from '../../types';
import {
  RESOLVED_TOC_ENTRIES_FIELD,
  type ResolvedTocEntry,
} from '../tocCachedEntries';

function readEntries(component: unknown): ResolvedTocEntry[] | undefined {
  return (component as Record<string, unknown>)[RESOLVED_TOC_ENTRIES_FIELD] as
    | ResolvedTocEntry[]
    | undefined;
}

describe('utils/tocCachedEntries', () => {
  it('auto-collects all headings for a document-scoped TOC', async () => {
    const doc: ReportComponentDefinition = {
      name: 'docx',
      props: { theme: TEST_THEME_NAME as never },
      children: [
        { name: 'toc', props: { title: 'Contents', scope: 'document' } },
        { name: 'heading', props: { text: 'Intro', level: 1 } },
        { name: 'heading', props: { text: 'Method', level: 2 } },
        { name: 'heading', props: { text: 'Results', level: 1 } },
      ],
    } as unknown as ReportComponentDefinition;

    const { sections } = await processDocument(
      doc,
      createMockTheme(),
      TEST_THEME_NAME
    );

    // Find the TOC component in the flattened sections.
    const toc = sections
      .flatMap((s) => s.components)
      .find((c) => c.name === 'toc');
    expect(toc).toBeDefined();

    const entries = readEntries(toc);
    expect(entries).toEqual([
      { title: 'Intro', level: 1 },
      { title: 'Method', level: 2 },
      { title: 'Results', level: 1 },
    ]);
  });

  it('filters out headings outside the depth window', async () => {
    const doc: ReportComponentDefinition = {
      name: 'docx',
      props: { theme: TEST_THEME_NAME as never },
      children: [
        {
          name: 'toc',
          props: { scope: 'document', depth: { from: 1, to: 1 } },
        },
        { name: 'heading', props: { text: 'In', level: 1 } },
        { name: 'heading', props: { text: 'Out', level: 2 } },
      ],
    } as unknown as ReportComponentDefinition;

    const { sections } = await processDocument(
      doc,
      createMockTheme(),
      TEST_THEME_NAME
    );
    const toc = sections
      .flatMap((s) => s.components)
      .find((c) => c.name === 'toc');
    const entries = readEntries(toc);
    expect(entries).toEqual([{ title: 'In', level: 1 }]);
  });

  it('section-scoped TOC only picks up headings in its own section, excluding the section title', async () => {
    const doc: ReportComponentDefinition = {
      name: 'docx',
      props: { theme: TEST_THEME_NAME as never },
      children: [
        {
          name: 'section',
          props: { title: 'Section A', level: 1 },
          children: [
            { name: 'toc', props: { scope: 'section' } },
            { name: 'heading', props: { text: 'A-Sub', level: 2 } },
          ],
        },
        {
          name: 'section',
          props: { title: 'Section B', level: 1 },
          children: [{ name: 'heading', props: { text: 'B-Sub', level: 2 } }],
        },
      ],
    } as unknown as ReportComponentDefinition;

    const { sections } = await processDocument(
      doc,
      createMockTheme(),
      TEST_THEME_NAME
    );

    // First section owns the TOC; it should see only "A-Sub" (section title
    // "Section A" is at the title level and must be skipped).
    const sectionAToc = sections[0].components.find((c) => c.name === 'toc');
    const entries = readEntries(sectionAToc);
    expect(entries).toEqual([{ title: 'A-Sub', level: 2 }]);
  });

  it('skips headings with empty text', async () => {
    const doc: ReportComponentDefinition = {
      name: 'docx',
      props: { theme: TEST_THEME_NAME as never },
      children: [
        { name: 'toc', props: { scope: 'document' } },
        { name: 'heading', props: { text: 'Keep', level: 1 } },
        { name: 'heading', props: { text: '   ', level: 1 } },
      ],
    } as unknown as ReportComponentDefinition;

    const { sections } = await processDocument(
      doc,
      createMockTheme(),
      TEST_THEME_NAME
    );
    const toc = sections
      .flatMap((s) => s.components)
      .find((c) => c.name === 'toc');
    const entries = readEntries(toc);
    expect(entries).toEqual([{ title: 'Keep', level: 1 }]);
  });
});
