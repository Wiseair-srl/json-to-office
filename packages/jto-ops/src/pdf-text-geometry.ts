/**
 * Text geometry from a rendered PDF — the ground truth the quality
 * estimators are guessing at (#216 follow-up).
 *
 * The pptx preview pipeline already produces a PDF (soffice → pdftoppm) and
 * uses it purely as a bitmap source. That PDF records the exact position of
 * every glyph as laid out by LibreOffice — the same engine the quality rules
 * try to predict. `pdftotext -bbox` (poppler, already a rasterizer
 * dependency alongside pdftoppm) dumps per-word bounding boxes; this module
 * parses them into slide-space points so callers can compare a rule's
 * estimate against what the renderer actually did.
 *
 * Coordinates: PDF points (1/72 in), origin at the page's top-left corner,
 * y increasing downward — the same frame as authored inches × 72. A PDF page
 * rendered from a slide has the slide's dimensions, so word boxes compare
 * directly against authored shape geometry with no transform.
 *
 * Consumers: the quality ground-truth harness (estimator calibration) today;
 * a `rendered`-certainty analysis pass tomorrow.
 */

import { execFile } from 'child_process';
import * as path from 'path';

/** One word as laid out on the page, in PDF points, top-left origin. */
export interface PdfTextWord {
  text: string;
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

/**
 * One line as poppler's layout analysis grouped it (`-bbox-layout` only):
 * its box plus the indices into `words` of the words on it.
 */
export interface PdfTextLine {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
  words: number[];
}

/** One PDF page: its size in points plus every word poppler segmented. */
export interface PdfTextPage {
  widthPt: number;
  heightPt: number;
  /** Every word in stream order, whichever mode produced the page. */
  words: PdfTextWord[];
  /** Line grouping; empty for plain `-bbox` output, which groups nothing. */
  lines: PdfTextLine[];
}

const ENTITIES: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&#34;': '"',
  '&#39;': "'",
};

function decodeEntities(value: string): string {
  return value.replace(
    /&(?:amp|lt|gt|quot|apos|#34|#39);/g,
    (entity) => ENTITIES[entity] ?? entity
  );
}

const PAGE_PATTERN =
  /<page\s+width="([\d.]+)"\s+height="([\d.]+)">([\s\S]*?)<\/page>/g;
// A line opens or closes; words between the two belong to it. Plain -bbox
// output has no lines at all, so the same walk yields an empty grouping.
const LINE_OR_WORD_PATTERN =
  /<line\s+xMin="(-?[\d.]+)"\s+yMin="(-?[\d.]+)"\s+xMax="(-?[\d.]+)"\s+yMax="(-?[\d.]+)">|<\/line>|<word\s+xMin="(-?[\d.]+)"\s+yMin="(-?[\d.]+)"\s+xMax="(-?[\d.]+)"\s+yMax="(-?[\d.]+)">([\s\S]*?)<\/word>/g;

/**
 * Parse `pdftotext -bbox` or `-bbox-layout` output (XHTML with `<page>`,
 * optionally `<line>`, and `<word>` elements). Pure — feed it a captured
 * document for tests, or the runner's stdout.
 */
export function parsePdfTextBbox(bboxXml: string): PdfTextPage[] {
  const pages: PdfTextPage[] = [];
  for (const pageMatch of bboxXml.matchAll(PAGE_PATTERN)) {
    const words: PdfTextWord[] = [];
    const lines: PdfTextLine[] = [];
    let open: PdfTextLine | undefined;
    for (const token of pageMatch[3].matchAll(LINE_OR_WORD_PATTERN)) {
      if (token[0] === '</line>') {
        if (open) lines.push(open);
        open = undefined;
      } else if (token[1] !== undefined) {
        open = {
          xMin: Number(token[1]),
          yMin: Number(token[2]),
          xMax: Number(token[3]),
          yMax: Number(token[4]),
          words: [],
        };
      } else {
        open?.words.push(words.length);
        words.push({
          xMin: Number(token[5]),
          yMin: Number(token[6]),
          xMax: Number(token[7]),
          yMax: Number(token[8]),
          text: decodeEntities(token[9]),
        });
      }
    }
    pages.push({
      widthPt: Number(pageMatch[1]),
      heightPt: Number(pageMatch[2]),
      words,
      lines,
    });
  }
  return pages;
}

function pdftotextCandidates(): string[] {
  const candidates: string[] = [];
  const configured = process.env.PDFTOTEXT_PATH?.trim();
  if (configured) candidates.push(configured);
  candidates.push('pdftotext');
  return [...new Set(candidates)];
}

async function run(
  binary: string,
  args: string[],
  timeoutMs: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      binary,
      args,
      { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      }
    );
  });
}

// Same memoization shape as the rasterizer's soffice/pdftoppm resolution:
// success is cached per process, failure retries on the next call.
let pdftotextPromise: Promise<string> | undefined;
async function resolvePdftotext(): Promise<string> {
  if (!pdftotextPromise) {
    pdftotextPromise = (async () => {
      for (const candidate of pdftotextCandidates()) {
        if (candidate.includes(path.sep)) {
          try {
            await run(candidate, ['-v'], 10_000);
            return candidate;
          } catch {
            continue;
          }
        }
        try {
          await run(candidate, ['-v'], 10_000);
          return candidate;
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          // pdftotext -v exits 0 on modern poppler; a non-ENOENT failure
          // still means the binary exists.
          if (code !== 'ENOENT' && code !== 'EACCES') return candidate;
        }
      }
      throw new Error(
        'Text geometry extraction needs pdftotext (poppler), which was not ' +
          'found. Install poppler-utils or set PDFTOTEXT_PATH ' +
          `(searched: ${pdftotextCandidates().join(', ')}).`
      );
    })().catch((error) => {
      pdftotextPromise = undefined;
      throw error;
    });
  }
  return pdftotextPromise;
}

/** True when a `pdftotext` binary is reachable — lets harnesses skip early. */
export async function pdftotextAvailable(): Promise<boolean> {
  try {
    await resolvePdftotext();
    return true;
  } catch {
    return false;
  }
}

/**
 * Extract per-word text geometry from a PDF on disk. One pdftotext spawn,
 * output streamed through stdout — nothing else touches the filesystem.
 * `layout: true` asks poppler for its line grouping too (`-bbox-layout`).
 */
export async function extractPdfTextGeometry(
  pdfPath: string,
  options: { timeoutMs?: number; layout?: boolean } = {}
): Promise<PdfTextPage[]> {
  const binary = await resolvePdftotext();
  const stdout = await run(
    binary,
    [options.layout ? '-bbox-layout' : '-bbox', pdfPath, '-'],
    options.timeoutMs ?? 60_000
  );
  return parsePdfTextBbox(stdout);
}
