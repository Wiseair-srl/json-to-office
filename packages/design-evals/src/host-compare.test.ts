import { describe, expect, it } from 'vitest';

import {
  compareHosts,
  hostComparisonMarkdown,
  type HostRun,
} from './host-compare.js';

const loop = (overrides: Partial<HostRun['loop']> = {}): HostRun['loop'] => ({
  scaffolded: true,
  validations: 3,
  previews: 1,
  contactSheets: 1,
  critiqueInspections: 1,
  critiqueRecords: 1,
  generations: 1,
  ...overrides,
});

const run = (overrides: Partial<HostRun> = {}): HostRun => ({
  briefId: 'cr-a',
  format: 'docx',
  outcome: 'completed',
  iterations: 2,
  toolCalls: 20,
  pages: 5,
  integrityDefect: false,
  pageDefects: 0,
  environmentFailures: 0,
  loop: loop(),
  level: 4,
  ships: true,
  ...overrides,
});

describe('compareHosts', () => {
  const desktop = [
    run({
      iterations: 1,
      toolCalls: 14,
      loop: loop({ critiqueRecords: 0, critiqueInspections: 0 }),
    }),
    run({
      briefId: 'cd-a',
      format: 'pptx',
      ships: false,
      level: 3,
      pageDefects: 1,
    }),
  ];
  const headless = [
    run({ iterations: 2 }),
    run({ iterations: 4, ships: false, level: 3 }),
    run({ iterations: 3 }),
    run({
      briefId: 'cd-a',
      format: 'pptx',
      outcome: 'failed',
      ships: false,
      level: undefined,
      loop: loop({ generations: 1 }),
    }),
  ];

  it('pairs each brief with its runs on both hosts', () => {
    const comparison = compareHosts(desktop, headless);
    expect(
      comparison.briefs.map((entry) => [
        entry.briefId,
        entry.desktop.length,
        entry.headless.length,
      ])
    ).toEqual([
      ['cd-a', 1, 1],
      ['cr-a', 1, 3],
    ]);
  });

  it('summarises each host by format: delivery, integrity, iterations, loop use and judged quality', () => {
    const { byFormat } = compareHosts(desktop, headless);
    expect(byFormat.docx.desktop).toMatchObject({
      runs: 1,
      delivered: 1,
      withIntegrityDefect: 0,
      medianIterations: 1,
      medianToolCalls: 14,
      scaffolded: 1,
      recordedCritique: 0,
      contactSheet: 1,
      ships: 1,
      medianLevel: 4,
    });
    expect(byFormat.docx.headless).toMatchObject({
      runs: 3,
      delivered: 3,
      medianIterations: 3,
      recordedCritique: 3,
      ships: 2,
      medianLevel: 4,
    });
    // A failed run is in the denominator, delivers nothing and ships nothing.
    expect(byFormat.pptx.headless).toMatchObject({
      runs: 1,
      delivered: 0,
      ships: 0,
    });
    expect(byFormat.pptx.desktop).toMatchObject({ withPageDefects: 1 });
  });

  it('renders a table a reader can check by brief', () => {
    const markdown = hostComparisonMarkdown(compareHosts(desktop, headless));
    expect(markdown).toContain(
      '| cr-a | docx | Desktop | L4 ship | 1 | 14 | yes |'
    );
    expect(markdown).toContain(
      '| cr-a | docx | headless | L4 ship · L3 · L4 ship |'
    );
    expect(markdown).toMatch(/\| intervened \|/);
  });
});
