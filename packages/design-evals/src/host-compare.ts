/**
 * Claude Desktop against the headless runner, brief by brief (#422).
 *
 * The headless runner stands in for Desktop in every scorecard, and nothing
 * yet says how well. This compares the two on the same briefs: whether each
 * delivered, what integrity defects reached the page, how many repairs it
 * took, how much of the authoring loop it walked, and — when both sets were
 * judged in one sitting — how the judge and the frozen shipping definition
 * read the results. Formats are summarised apart, because a host difference
 * that holds for reports need not hold for decks.
 */

import { median } from './scorecard.js';
import type { LoopUsage } from './desktop.js';

export interface HostRun {
  briefId: string;
  format: string;
  outcome: 'completed' | 'failed';
  iterations: number;
  toolCalls: number;
  pages: number;
  integrityDefect: boolean;
  pageDefects: number;
  environmentFailures: number;
  loop: LoopUsage;
  /** The shared sitting's verdict, when both sets were judged in one. */
  level?: number;
  ships?: boolean;
}

export interface HostSummary {
  runs: number;
  delivered: number;
  withIntegrityDefect: number;
  withPageDefects: number;
  withEnvironmentFailure: number;
  medianIterations: number;
  medianToolCalls: number;
  scaffolded: number;
  contactSheet: number;
  recordedCritique: number;
  /** Runs the definition ships; failed runs count as not shipped. */
  ships: number;
  medianLevel: number;
}

export interface HostComparison {
  briefs: Array<{
    briefId: string;
    format: string;
    desktop: HostRun[];
    headless: HostRun[];
  }>;
  byFormat: Record<string, { desktop: HostSummary; headless: HostSummary }>;
}

function summarize(runs: readonly HostRun[]): HostSummary {
  const completed = runs.filter((run) => run.outcome === 'completed');
  return {
    runs: runs.length,
    delivered: completed.length,
    withIntegrityDefect: runs.filter(
      (run) => run.outcome === 'failed' || run.integrityDefect
    ).length,
    withPageDefects: runs.filter((run) => run.pageDefects > 0).length,
    withEnvironmentFailure: runs.filter((run) => run.environmentFailures > 0)
      .length,
    medianIterations: median(completed.map((run) => run.iterations)),
    medianToolCalls: median(completed.map((run) => run.toolCalls)),
    scaffolded: runs.filter((run) => run.loop.scaffolded).length,
    contactSheet: runs.filter((run) => run.loop.contactSheets > 0).length,
    recordedCritique: runs.filter((run) => run.loop.critiqueRecords > 0).length,
    ships: runs.filter((run) => run.outcome === 'completed' && run.ships)
      .length,
    medianLevel: median(
      runs.flatMap((run) => (run.level === undefined ? [] : [run.level]))
    ),
  };
}

export function compareHosts(
  desktop: readonly HostRun[],
  headless: readonly HostRun[]
): HostComparison {
  const briefIds = [
    ...new Set([...desktop, ...headless].map((run) => run.briefId)),
  ].sort();
  const briefs = briefIds.map((briefId) => {
    const onDesktop = desktop.filter((run) => run.briefId === briefId);
    const onHeadless = headless.filter((run) => run.briefId === briefId);
    return {
      briefId,
      format: (onDesktop[0] ?? onHeadless[0]).format,
      desktop: onDesktop,
      headless: onHeadless,
    };
  });
  const formats = [...new Set(briefs.map((entry) => entry.format))].sort();
  const byFormat: HostComparison['byFormat'] = {};
  for (const format of formats) {
    byFormat[format] = {
      desktop: summarize(desktop.filter((run) => run.format === format)),
      headless: summarize(headless.filter((run) => run.format === format)),
    };
  }
  return { briefs, byFormat };
}

const cell = (runs: readonly HostRun[], read: (run: HostRun) => string) =>
  runs.length === 0 ? '—' : runs.map(read).join(' · ');

const verdict = (run: HostRun) =>
  run.outcome === 'failed'
    ? 'failed'
    : `L${run.level ?? '?'}${run.ships ? ' ship' : ''}`;

/** The comparison as a reader checks it: one row per brief, then per format. */
export function hostComparisonMarkdown(comparison: HostComparison): string {
  const lines = [
    '| brief | format | Desktop: verdict | headless: verdict | Desktop: iterations | headless: iterations | Desktop: critique recorded | headless: critique recorded |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...comparison.briefs.map(
      (entry) =>
        `| ${entry.briefId} | ${entry.format} | ${cell(entry.desktop, verdict)} | ${cell(entry.headless, verdict)} | ${cell(entry.desktop, (run) => String(run.iterations))} | ${cell(entry.headless, (run) => String(run.iterations))} | ${cell(entry.desktop, (run) => String(run.loop.critiqueRecords))} | ${cell(entry.headless, (run) => String(run.loop.critiqueRecords))} |`
    ),
    '',
    '| format | host | runs | delivered | integrity defect | page defects | median iterations | contact sheet | critique recorded | ships | median level |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const [format, hosts] of Object.entries(comparison.byFormat)) {
    for (const [host, summary] of [
      ['Desktop', hosts.desktop],
      ['headless', hosts.headless],
    ] as const) {
      lines.push(
        `| ${format} | ${host} | ${summary.runs} | ${summary.delivered} | ${summary.withIntegrityDefect} | ${summary.withPageDefects} | ${summary.medianIterations} | ${summary.contactSheet} | ${summary.recordedCritique} | ${summary.ships} | ${summary.medianLevel} |`
      );
    }
  }
  return `${lines.join('\n')}\n`;
}
