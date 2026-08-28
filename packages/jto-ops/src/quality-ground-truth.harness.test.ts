/**
 * Ground-truth harness for the pptx text-fit estimator (#216 follow-up).
 *
 * The calibration suite pins one direction: the reference templates
 * (`STOCK_REFERENCE_TEMPLATES`) come back warning-clean (false-positive
 * control). Nothing measures the other direction — whether the estimator
 * actually fires on real overflows. This harness renders mutated stock
 * templates through the real pipeline (core-pptx → soffice → PDF), reads
 * exact word geometry back out of the PDF with `pdftotext -bbox`, and scores
 * the rule's predictions against what LibreOffice actually laid out.
 *
 * Mutation deliberately spans every stock template, reference or not: a
 * mutated box only supplies realistic geometry, and the verdict comes from
 * the renderer. Reference quality matters to the calibration gate and to
 * threshold tuning, never to this measurement.
 *
 * Method: for each stock template, sample top-aligned, unrotated text boxes
 * with full geometry and replace their text with filler sized at fixed ratios
 * of the estimator's own capacity (0.6× … 2.2×), each ending in a unique
 * sentinel word. The sentinel is the last word, so its rendered bottom edge
 * against the box bottom is the measured spill. Other alignments can overflow
 * above the box and rotated PDF coordinates need a transform, so neither is
 * admitted into this bottom-edge measurement.
 *
 * This file is excluded from the default test run (it launches LibreOffice;
 * minutes, not milliseconds) — run it with:
 *
 *   pnpm --filter @json-to-office/core-pptx build   # facts come from dist
 *   pnpm --filter @json-to-office/jto-ops test:ground-truth
 *
 * It is a measurement, not (yet) a regression gate: the summary prints
 * detection/false-positive rates and the estimator's signed bias. Once those
 * numbers are accepted, thresholds can be pinned here the way
 * quality-calibration.test.ts pins the clean-template invariant.
 *
 * Accepted baseline (2026-08, factor 0.46; 130 comparable measurements): 52%
 * of >1-line-height spills flagged as OVERFLOW, 91% flagged at least TIGHT,
 * 87% of any visible spill flagged, no OVERFLOW false alarms, and zero
 * warnings on the authored reference templates. The remaining misses belong
 * to a `rendered`-certainty pass built on extractPdfTextGeometry.
 */

import { execFile } from 'child_process';
import { promises as fs, readdirSync, readFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { PptxFormatAdapter } from './format-adapter';
import {
  extractPdfTextGeometry,
  pdftotextAvailable,
} from './pdf-text-geometry';

const TEMPLATES_DIR = path.resolve(
  __dirname,
  '../../jto/src/client/public/templates'
);
const THEMES_DIR = path.join(TEMPLATES_DIR, 'themes');

// Filler sizing only — predictions always come from analyzeQuality with the
// rule's own shipped parameters, so this constant does not need to track the
// rule's factor; it just decides where the variants land relative to the
// estimate.
const CHAR_WIDTH_FACTOR = 0.45;
const BOXES_PER_TEMPLATE = 4;
const RATIOS = [0.6, 0.95, 1.15, 1.6, 2.2] as const;
/** Spill below this is sub-visual: renderer rounding, descender fuzz. */
const VISIBLE_SPILL_PT = 2;

const FILLER_WORDS =
  'strategy review growth market revenue product quarter customer team plan result value impact delivery roadmap risk margin cost signal focus'.split(
    ' '
  );

// ---------------------------------------------------------------------------
// Binaries (mirrors pptx-rasterizer's resolution; local to the harness).

async function exec(
  binary: string,
  args: string[],
  timeoutMs: number
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    execFile(binary, args, { timeout: timeoutMs }, (error) =>
      error ? reject(error) : resolve()
    );
  });
}

async function binaryWorks(binary: string): Promise<boolean> {
  try {
    await exec(binary, ['--version'], 10_000);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code !== 'ENOENT' && code !== 'EACCES';
  }
}

async function findSoffice(): Promise<string | undefined> {
  const candidates = [
    process.env.LIBREOFFICE_PATH?.trim(),
    process.platform === 'darwin'
      ? '/Applications/LibreOffice.app/Contents/MacOS/soffice'
      : undefined,
    'soffice',
    'libreoffice',
  ].filter((c): c is string => Boolean(c));
  for (const candidate of candidates) {
    if (candidate.includes(path.sep)) {
      try {
        await fs.access(candidate);
      } catch {
        continue;
      }
    }
    if (await binaryWorks(candidate)) return candidate;
  }
  return undefined;
}

const sofficeBinary = await findSoffice();
const popplerAvailable = await pdftotextAvailable();
const RUN = Boolean(sofficeBinary) && popplerAvailable;

// ---------------------------------------------------------------------------
// JSON pointer helpers (RFC 6901) — enough for get/set on plain JSON.

function pointerSegments(pointer: string): string[] {
  return pointer
    .split('/')
    .slice(1)
    .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function pointerGet(doc: unknown, pointer: string): unknown {
  let node: any = doc;
  for (const segment of pointerSegments(pointer)) {
    if (node == null) return undefined;
    node = node[segment];
  }
  return node;
}

function pointerSet(doc: unknown, pointer: string, value: unknown): void {
  const segments = pointerSegments(pointer);
  let node: any = doc;
  for (const segment of segments.slice(0, -1)) node = node[segment];
  node[segments[segments.length - 1]] = value;
}

// ---------------------------------------------------------------------------
// Estimator inversion — filler sized against the rule's own model.

interface BoxFact {
  path: string;
  text: string;
  fontSizePt: number;
  lineSpacingPt: number;
  boxXPt: number;
  boxYPt: number;
  boxWidthPt: number;
  boxHeightPt: number;
  verticalAlign: 'top' | 'middle' | 'bottom';
  rotationDeg: number;
  autoFit: boolean;
}

function comparableGroundTruthBox(fact: BoxFact): boolean {
  const normalizedRotation = ((fact.rotationDeg % 360) + 360) % 360;
  return fact.verticalAlign === 'top' && normalizedRotation < 1e-6;
}

/**
 * Fold rendered text and authored text into the same space: NFKC decomposes
 * ligatures (ﬁ → fi), and stripping non-alphanumerics drops bullet glyphs,
 * inserted hyphens, and punctuation that soffice/poppler render differently
 * from the authored string.
 */
function normalizeForMatch(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Locate `rawNeedle` on a page by concatenating normalized word fragments in
 * stream order. Narrow boxes hard-wrap a word mid-word and letter-spaced text
 * makes poppler segment it into per-cluster fragments; a single-word match
 * loses both. The concatenated stream keeps them, and the match's last
 * fragment ends exactly at the bottom edge the spill measurement needs.
 */
function findSentinel(
  pages: { words: { text: string; yMax: number }[] }[],
  rawNeedle: string,
  pageIndex?: number
): { yMax: number } | 'missing' | 'ambiguous' {
  const needle = normalizeForMatch(rawNeedle);
  if (needle === '') return 'missing';
  const hits: { yMax: number }[] = [];
  pages.forEach((page, index) => {
    if (pageIndex !== undefined && index !== pageIndex) return;
    const fragments = page.words.map((w) => normalizeForMatch(w.text));
    const stream = fragments.join('');
    const positions: number[] = [];
    let cursor = 0;
    for (const fragment of fragments) {
      positions.push(cursor);
      cursor += fragment.length;
    }
    let searchFrom = 0;
    for (;;) {
      const at = stream.indexOf(needle, searchFrom);
      if (at === -1) break;
      searchFrom = at + needle.length;
      const end = at + needle.length;
      let yMax = -Infinity;
      for (let i = 0; i < page.words.length; i++) {
        const start = positions[i];
        const stop = start + fragments[i].length;
        if (stop > at && start < end) yMax = Math.max(yMax, page.words[i].yMax);
      }
      hits.push({ yMax });
    }
  });
  if (hits.length === 0) return 'missing';
  if (hits.length > 1) return 'ambiguous';
  return hits[0];
}

/** Rendered PDF page index for an authored `/children/N/...` path. */
function renderedPageIndex(doc: unknown, boxPath: string): number | undefined {
  const match = /^\/children\/(\d+)/.exec(boxPath);
  if (!match) return undefined;
  const authoredIndex = Number(match[1]);
  const children = Array.isArray((doc as any)?.children)
    ? (doc as any).children
    : [];
  let rendered = 0;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const isSlide = child?.name === 'slide' && child?.enabled !== false;
    if (i === authoredIndex) return isSlide ? rendered : undefined;
    if (isSlide) rendered++;
  }
  return undefined;
}

function capacityChars(fact: BoxFact): number {
  const charsPerLine = Math.max(
    1,
    Math.floor(fact.boxWidthPt / (fact.fontSizePt * CHAR_WIDTH_FACTOR))
  );
  const lines = Math.max(
    1,
    Math.floor((fact.boxHeightPt - fact.fontSizePt) / fact.lineSpacingPt) + 1
  );
  return charsPerLine * lines;
}

function fillerText(targetChars: number, sentinel: string): string {
  let text = '';
  let i = 0;
  while (text.length + sentinel.length + 1 < targetChars) {
    text += (text === '' ? '' : ' ') + FILLER_WORDS[i % FILLER_WORDS.length];
    i++;
  }
  return text === '' ? sentinel : `${text} ${sentinel}`;
}

/** Set the sampled box's text, whether it is a component or a placeholder. */
function mutateBoxText(doc: unknown, boxPath: string, text: string): boolean {
  const target = pointerGet(doc, boxPath);
  if (typeof target === 'string') {
    pointerSet(doc, boxPath, text);
    return true;
  }
  if (
    typeof target === 'object' &&
    target !== null &&
    typeof (target as any).props?.text === 'string'
  ) {
    pointerSet(doc, `${boxPath}/props/text`, text);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Case bookkeeping.

type PredictedVerdict = 'fit' | 'tight' | 'overflow';
type ActualVerdict = 'fit' | 'invisible' | 'small-spill' | 'big-spill';

interface CaseResult {
  template: string;
  boxPath: string;
  ratio: number;
  fontSizePt: number;
  lineSpacingPt: number;
  boxWidthPt: number;
  boxHeightPt: number;
  boxYPt: number;
  autoFit: boolean;
  fillerChars: number;
  predicted: PredictedVerdict;
  predictedMarginPt: number | undefined;
  actual: ActualVerdict | 'missing' | 'ambiguous';
  actualSpillPt: number | undefined;
}

function actualVerdict(spillPt: number, lineSpacingPt: number): ActualVerdict {
  if (spillPt <= 0) return 'fit';
  if (spillPt <= VISIBLE_SPILL_PT) return 'invisible';
  if (spillPt <= lineSpacingPt) return 'small-spill';
  return 'big-spill';
}

function pct(n: number, d: number): string {
  return d === 0 ? 'n/a' : `${((100 * n) / d).toFixed(0)}% (${n}/${d})`;
}

// ---------------------------------------------------------------------------

describe.skipIf(!RUN)(
  'pptx text-fit estimator vs rendered ground truth',
  () => {
    it(
      'measures detection, false positives, and estimator bias',
      { timeout: 600_000 },
      async () => {
        const corePptx = await import('@json-to-office/core-pptx');
        const adapter = new PptxFormatAdapter();

        const customThemes: Record<string, unknown> = {};
        for (const file of readdirSync(THEMES_DIR)) {
          if (!file.endsWith('.pptx.theme.json')) continue;
          const theme = JSON.parse(
            readFileSync(path.join(THEMES_DIR, file), 'utf8')
          );
          customThemes[theme.name ?? file.replace('.pptx.theme.json', '')] =
            theme;
        }

        const tempDir = await fs.mkdtemp(
          path.join(os.tmpdir(), 'jto-ground-truth-')
        );
        const profileDir = path.join(tempDir, 'soffice-profile');
        interface Deck {
          pptxPath: string;
          pdfPath: string;
          doc: unknown;
          cases: {
            fact: BoxFact;
            sentinel: string;
            template: string;
            ratio: number;
            fillerChars: number;
          }[];
        }
        const decks: Deck[] = [];

        // -- Probe deck: pins the PDF coordinate convention before anything
        //    else is trusted. One box at a known position; if its word lands
        //    outside the expected frame, every measurement would be garbage.
        const PROBE = {
          name: 'pptx',
          props: { slideWidth: 13.333, slideHeight: 7.5 },
          children: [
            {
              name: 'slide',
              children: [
                {
                  name: 'text',
                  props: {
                    text: 'JTOPROBE',
                    x: 1,
                    y: 1,
                    w: 5,
                    h: 1.5,
                    fontSize: 24,
                  },
                },
              ],
            },
          ],
        };

        // -- Build mutated decks: one deck per (template, ratio), every
        //    sampled box mutated at once (shapes do not reflow one another).
        const templates = readdirSync(TEMPLATES_DIR).filter((f) =>
          f.endsWith('.pptx.json')
        );
        const skipped: string[] = [];
        const excludedLayouts: string[] = [];

        for (const file of templates) {
          const original = JSON.parse(
            readFileSync(path.join(TEMPLATES_DIR, file), 'utf8')
          );
          const prepared = corePptx.preparePptxQualityDocument(original, {
            customThemes: customThemes as any,
          });
          const slideHeightPt =
            ((prepared.model as any).processed?.slideHeight ?? 7.5) * 72;
          const measurable = prepared.facts.filter(
            (fact: any): fact is BoxFact & { kind: 'pptx/text' } =>
              fact.kind === 'pptx/text' &&
              fact.boxXPt !== undefined &&
              fact.boxYPt !== undefined &&
              fact.boxWidthPt !== undefined &&
              fact.boxHeightPt !== undefined &&
              !fact.path.startsWith('/props/templates/') &&
              mutateBoxText(structuredClone(original), fact.path, 'probe')
          );
          const candidates = measurable.filter(comparableGroundTruthBox);
          const excludedCount = measurable.length - candidates.length;
          if (excludedCount > 0) {
            excludedLayouts.push(
              `${file}: ${excludedCount} non-top or rotated box(es)`
            );
          }
          if (candidates.length === 0) {
            skipped.push(
              `${file}: no comparable mutable box with full geometry`
            );
            continue;
          }
          // Spread the sample across slides: sort by path, stride-pick.
          const stride = Math.max(
            1,
            Math.floor(candidates.length / BOXES_PER_TEMPLATE)
          );
          const sampled = candidates
            .filter((_: unknown, i: number) => i % stride === 0)
            .slice(0, BOXES_PER_TEMPLATE);

          for (const ratio of RATIOS) {
            const doc = structuredClone(original);
            const cases = sampled.map((fact: BoxFact, boxIndex: number) => {
              const sentinel = `ZQJTOB${boxIndex}X`;
              // Cap the filler so the estimated text bottom stays on the page:
              // words pushed past the slide edge vanish from the PDF and the
              // case becomes unmeasurable. The 0.75 guard absorbs the model
              // wrapping later than the renderer does.
              const charsPerLine = Math.max(
                1,
                Math.floor(
                  fact.boxWidthPt / (fact.fontSizePt * CHAR_WIDTH_FACTOR)
                )
              );
              const linesToPage = Math.max(
                1,
                Math.floor(
                  (slideHeightPt - fact.boxYPt - fact.fontSizePt) /
                    fact.lineSpacingPt
                ) + 1
              );
              const target = Math.min(
                Math.floor(0.75 * charsPerLine * linesToPage),
                Math.max(
                  sentinel.length + 1,
                  Math.round(capacityChars(fact) * ratio)
                )
              );
              const filler = fillerText(
                Math.max(sentinel.length, target),
                sentinel
              );
              mutateBoxText(doc, fact.path, filler);
              return {
                fact,
                sentinel,
                template: file,
                ratio,
                fillerChars: filler.length,
              };
            });
            const stem = `${file.replace(/[^a-zA-Z0-9]/g, '_')}-r${ratio}`;
            const pptxPath = path.join(tempDir, `${stem}.pptx`);
            const buffer = await corePptx.generateBufferFromJson(
              doc as any,
              {
                baseDir: TEMPLATES_DIR,
                customThemes: customThemes as any,
              } as any
            );
            await fs.writeFile(pptxPath, buffer);
            decks.push({
              pptxPath,
              pdfPath: path.join(tempDir, `${stem}.pdf`),
              doc,
              cases,
            });
          }
        }

        const probePath = path.join(tempDir, 'probe.pptx');
        await fs.writeFile(
          probePath,
          await corePptx.generateBufferFromJson(PROBE as any, {} as any)
        );

        // -- One soffice launch for every deck (probe included).
        await exec(
          sofficeBinary as string,
          [
            '--headless',
            '--norestore',
            '--nolockcheck',
            '--nodefault',
            `-env:UserInstallation=file://${profileDir.replace(/\\/g, '/')}`,
            '--convert-to',
            'pdf:impress_pdf_Export',
            '--outdir',
            tempDir,
            probePath,
            ...decks.map((d) => d.pptxPath),
          ],
          480_000
        );

        // -- Coordinate self-check.
        const probePages = await extractPdfTextGeometry(
          path.join(tempDir, 'probe.pdf')
        );
        expect(probePages).toHaveLength(1);
        expect(probePages[0].widthPt).toBeCloseTo(13.333 * 72, 0);
        expect(probePages[0].heightPt).toBeCloseTo(7.5 * 72, 0);
        const probeWord = probePages[0].words.find(
          (w) => w.text === 'JTOPROBE'
        );
        expect(
          probeWord,
          'probe word must be present in the PDF'
        ).toBeDefined();
        // Inside the authored box (x=72..432pt, y=72..180pt), any inset/anchor.
        expect(probeWord!.xMin).toBeGreaterThanOrEqual(72 - 1);
        expect(probeWord!.xMax).toBeLessThanOrEqual(432 + 1);
        expect(probeWord!.yMin).toBeGreaterThanOrEqual(72 - 1);
        expect(probeWord!.yMax).toBeLessThanOrEqual(180 + 1);

        // -- Score each deck: prediction from analyzeQuality, truth from PDF.
        const results: CaseResult[] = [];
        for (const deck of decks) {
          const analysis = await adapter.analyzeQuality(deck.doc, {
            customThemes: customThemes as any,
          } as any);
          const pages = await extractPdfTextGeometry(deck.pdfPath).catch(
            () => null
          );
          for (const kase of deck.cases) {
            const diag = analysis.diagnostics.find(
              (d: any) =>
                d.path === kase.fact.path &&
                (d.code.includes('TEXT_OVERFLOW') ||
                  d.code.includes('TEXT_TIGHT'))
            ) as any;
            const predicted: PredictedVerdict = diag
              ? diag.code.includes('OVERFLOW')
                ? 'overflow'
                : 'tight'
              : 'fit';
            const predictedMarginPt =
              typeof diag?.context?.marginPt === 'number'
                ? diag.context.marginPt
                : undefined;

            const found = pages
              ? findSentinel(pages, kase.sentinel)
              : 'missing';
            let actual: CaseResult['actual'];
            let actualSpillPt: number | undefined;
            if (found === 'missing' || found === 'ambiguous') actual = found;
            else {
              actualSpillPt =
                found.yMax - (kase.fact.boxYPt + kase.fact.boxHeightPt);
              actual = actualVerdict(actualSpillPt, kase.fact.lineSpacingPt);
            }
            results.push({
              template: kase.template,
              boxPath: kase.fact.path,
              ratio: kase.ratio,
              fontSizePt: kase.fact.fontSizePt,
              lineSpacingPt: kase.fact.lineSpacingPt,
              boxWidthPt: kase.fact.boxWidthPt,
              boxHeightPt: kase.fact.boxHeightPt,
              boxYPt: kase.fact.boxYPt,
              autoFit: kase.fact.autoFit === true,
              fillerChars: kase.fillerChars,
              predicted,
              predictedMarginPt,
              actual,
              actualSpillPt,
            });
          }
        }

        // -- Report.
        const measured = results.filter(
          (r) => r.actual !== 'missing' && r.actual !== 'ambiguous'
        );
        const unmeasured = results.length - measured.length;
        const bigSpills = measured.filter((r) => r.actual === 'big-spill');
        const anyVisible = measured.filter(
          (r) => r.actual === 'small-spill' || r.actual === 'big-spill'
        );
        const actualFits = measured.filter(
          (r) => r.actual === 'fit' || r.actual === 'invisible'
        );

        const caughtBig = bigSpills.filter((r) => r.predicted === 'overflow');
        const flaggedAnyOnBig = bigSpills.filter((r) => r.predicted !== 'fit');
        const flaggedAnyOnVisible = anyVisible.filter(
          (r) => r.predicted !== 'fit'
        );
        const falseAlarms = actualFits.filter(
          (r) => r.predicted === 'overflow'
        );

        const biases = measured
          .filter((r) => r.actualSpillPt !== undefined)
          .map((r) => {
            // Predicted spill − actual spill: positive = estimator over-warns.
            const predictedSpill = -(r.predictedMarginPt ?? 8);
            return predictedSpill - (r.actualSpillPt as number);
          })
          .sort((a, b) => a - b);
        const median = biases.length
          ? biases[Math.floor(biases.length / 2)]
          : NaN;

        const lines: string[] = [];
        lines.push('');
        lines.push('=== pptx text-fit: estimator vs rendered ground truth ===');
        lines.push(
          `cases: ${results.length} measured: ${measured.length} unmeasured: ${unmeasured} (sentinel missing/ambiguous)`
        );
        if (skipped.length)
          lines.push(`skipped templates: ${skipped.join('; ')}`);
        if (excludedLayouts.length)
          lines.push(`excluded layouts: ${excludedLayouts.join('; ')}`);
        lines.push('');
        lines.push('rule promise (warning on spill > one line-height):');
        lines.push(
          `  detection (big spills flagged as OVERFLOW):   ${pct(caughtBig.length, bigSpills.length)}`
        );
        lines.push(
          `  detection incl. TIGHT info on big spills:     ${pct(flaggedAnyOnBig.length, bigSpills.length)}`
        );
        lines.push(
          `  user experience (any visible spill flagged):  ${pct(flaggedAnyOnVisible.length, anyVisible.length)}`
        );
        lines.push(
          `  false alarms (OVERFLOW on actual fits):       ${pct(falseAlarms.length, actualFits.length)}`
        );
        lines.push(
          `  estimator bias (predicted−actual spill, pt):  median ${median.toFixed(1)}  p10 ${biases[Math.floor(biases.length * 0.1)]?.toFixed(1)}  p90 ${biases[Math.floor(biases.length * 0.9)]?.toFixed(1)}`
        );
        lines.push('');
        lines.push(
          'template | box | ratio | font | boxWxH | fit | chars | predMargin | predicted | actualSpill | actual'
        );
        for (const r of results) {
          lines.push(
            [
              r.template.replace('.pptx.json', ''),
              r.boxPath,
              r.ratio.toFixed(2),
              r.fontSizePt,
              `${r.boxWidthPt.toFixed(0)}x${r.boxHeightPt.toFixed(0)}`,
              r.autoFit ? 'auto' : 'fixed',
              r.fillerChars,
              r.predictedMarginPt?.toFixed(1) ?? '≥8',
              r.predicted,
              r.actualSpillPt?.toFixed(1) ?? '—',
              r.actual,
            ].join(' | ')
          );
        }
        const report = lines.join('\n');
        // eslint-disable-next-line no-console
        console.log(report);
        const reportPath = path.join(tempDir, 'report.txt');
        await fs.writeFile(
          reportPath,
          report +
            '\n\nJSON:\n' +
            JSON.stringify({ results, skipped, excludedLayouts }, null, 2)
        );
        // eslint-disable-next-line no-console
        console.log(`\nreport written to ${reportPath}`);

        // Infrastructure invariants only — metric thresholds get pinned once
        // the first accepted numbers exist.
        expect(measured.length).toBeGreaterThanOrEqual(20);
      }
    );
  }
);

describe.skipIf(!RUN)(
  'authored templates: flagged boxes vs rendered truth',
  () => {
    it(
      'measures the actual spill of every box the rule flags as-authored',
      { timeout: 600_000 },
      async () => {
        const corePptx = await import('@json-to-office/core-pptx');
        const adapter = new PptxFormatAdapter();

        const customThemes: Record<string, unknown> = {};
        for (const file of readdirSync(THEMES_DIR)) {
          if (!file.endsWith('.pptx.theme.json')) continue;
          const theme = JSON.parse(
            readFileSync(path.join(THEMES_DIR, file), 'utf8')
          );
          customThemes[theme.name ?? file.replace('.pptx.theme.json', '')] =
            theme;
        }

        const tempDir = await fs.mkdtemp(
          path.join(os.tmpdir(), 'jto-adjudicate-')
        );
        const profileDir = path.join(tempDir, 'soffice-profile');
        const templates = readdirSync(TEMPLATES_DIR).filter((f) =>
          f.endsWith('.pptx.json')
        );

        interface Flagged {
          template: string;
          path: string;
          code: string;
          predictedMarginPt: number | undefined;
          fact: BoxFact | undefined;
        }
        const flagged: Flagged[] = [];
        const pptxPaths: string[] = [];
        const byTemplate = new Map<string, { doc: unknown; pdfPath: string }>();

        for (const file of templates) {
          const doc = JSON.parse(
            readFileSync(path.join(TEMPLATES_DIR, file), 'utf8')
          );
          const prepared = corePptx.preparePptxQualityDocument(doc, {
            customThemes: customThemes as any,
          });
          const analysis = await adapter.analyzeQuality(doc, {
            customThemes: customThemes as any,
          } as any);
          for (const d of analysis.diagnostics as any[]) {
            if (!d.code.includes('TEXT_OVERFLOW')) continue;
            flagged.push({
              template: file,
              path: d.path,
              code: d.code,
              predictedMarginPt:
                typeof d.context?.marginPt === 'number'
                  ? d.context.marginPt
                  : undefined,
              fact: prepared.facts.find(
                (f: any) => f.kind === 'pptx/text' && f.path === d.path
              ) as BoxFact | undefined,
            });
          }
          if (
            flagged.some(
              (f) =>
                f.template === file &&
                f.fact !== undefined &&
                comparableGroundTruthBox(f.fact)
            )
          ) {
            const stem = file.replace(/[^a-zA-Z0-9]/g, '_');
            const pptxPath = path.join(tempDir, `${stem}.pptx`);
            await fs.writeFile(
              pptxPath,
              await corePptx.generateBufferFromJson(
                doc as any,
                {
                  baseDir: TEMPLATES_DIR,
                  customThemes: customThemes as any,
                } as any
              )
            );
            pptxPaths.push(pptxPath);
            byTemplate.set(file, {
              doc,
              pdfPath: path.join(tempDir, `${stem}.pdf`),
            });
          }
        }

        if (pptxPaths.length > 0) {
          await exec(
            sofficeBinary as string,
            [
              '--headless',
              '--norestore',
              '--nolockcheck',
              '--nodefault',
              `-env:UserInstallation=file://${profileDir.replace(/\\/g, '/')}`,
              '--convert-to',
              'pdf:impress_pdf_Export',
              '--outdir',
              tempDir,
              ...pptxPaths,
            ],
            480_000
          );
        }

        const lines: string[] = [];
        lines.push('');
        lines.push('=== authored flagged boxes: predicted vs rendered ===');
        lines.push(
          'template | box | font | boxWxH | predMargin | actualSpill | verdict'
        );
        const tallies = {
          confirmed: 0,
          rescued: 0,
          falseAlarm: 0,
          unsupported: 0,
          unmeasured: 0,
        };
        for (const f of flagged) {
          const entry = byTemplate.get(f.template);
          let actualSpill: number | undefined;
          let verdict = 'unmeasured';
          if (f.fact && !comparableGroundTruthBox(f.fact)) {
            verdict = 'unsupported-layout';
          } else if (entry && f.fact) {
            const pages = await extractPdfTextGeometry(entry.pdfPath).catch(
              () => null
            );
            // Last paragraph only: bullets and glyph substitutions live between
            // paragraphs, and the bottom edge belongs to the last one anyway.
            const paragraphs = f.fact.text
              .split('\n')
              .map((p) => normalizeForMatch(p))
              .filter((p) => p !== '');
            const needle = paragraphs[paragraphs.length - 1] ?? '';
            if (pages && needle.length >= 10) {
              const found = findSentinel(
                pages,
                needle,
                renderedPageIndex(entry.doc, f.path)
              );
              if (found !== 'missing' && found !== 'ambiguous') {
                actualSpill = found.yMax - (f.fact.boxYPt + f.fact.boxHeightPt);
                verdict =
                  actualSpill > f.fact.lineSpacingPt
                    ? 'confirmed-overflow'
                    : actualSpill > VISIBLE_SPILL_PT
                      ? 'small-spill'
                      : 'renderer-rescued';
              }
            }
          }
          if (verdict === 'confirmed-overflow') tallies.confirmed++;
          else if (verdict === 'small-spill') tallies.rescued++;
          else if (verdict === 'renderer-rescued') tallies.falseAlarm++;
          else if (verdict === 'unsupported-layout') tallies.unsupported++;
          else tallies.unmeasured++;
          lines.push(
            [
              f.template.replace('.pptx.json', ''),
              f.path,
              f.fact?.fontSizePt ?? '?',
              f.fact
                ? `${f.fact.boxWidthPt?.toFixed(0)}x${f.fact.boxHeightPt?.toFixed(0)}`
                : '?',
              f.predictedMarginPt?.toFixed(1) ?? '?',
              actualSpill?.toFixed(1) ?? '—',
              verdict,
            ].join(' | ')
          );
        }
        lines.push('');
        lines.push(
          `flagged: ${flagged.length}  confirmed: ${tallies.confirmed}  small-spill: ${tallies.rescued}  rescued/false: ${tallies.falseAlarm}  unsupported-layout: ${tallies.unsupported}  unmeasured: ${tallies.unmeasured}`
        );
        // eslint-disable-next-line no-console
        console.log(lines.join('\n'));
        expect(true).toBe(true);
      }
    );
  }
);

describe.skipIf(RUN)('ground-truth harness (binaries missing)', () => {
  it('skips: needs LibreOffice (soffice) and poppler (pdftotext)', () => {
    expect(RUN).toBe(false);
  });
});
