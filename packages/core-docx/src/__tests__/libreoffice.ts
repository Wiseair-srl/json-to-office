/**
 * Where the rendering tests find LibreOffice and pdftotext.
 *
 * Suites that need them skip themselves when a tool is missing, so no test
 * run depends on a GUI application being installed; `JTO_REQUIRE_LIBREOFFICE=1`
 * turns a missing tool into a failure where CI guarantees it.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export async function findLibreOffice(): Promise<string | undefined> {
  const candidates = [
    'soffice',
    '/Applications/LibreOffice.app/Contents/MacOS/soffice',
    '/usr/bin/soffice',
    '/usr/bin/libreoffice',
  ];
  for (const candidate of candidates) {
    try {
      await run(candidate, ['--version'], { timeout: 60_000 });
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  return undefined;
}

export async function hasPdftotext(): Promise<boolean> {
  try {
    await run('pdftotext', ['-v'], { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

/** Throws when the environment insists on the tools and one is missing. */
export function requireIfInsisted(found: boolean, what: string): void {
  if (process.env.JTO_REQUIRE_LIBREOFFICE === '1' && !found)
    throw new Error(`JTO_REQUIRE_LIBREOFFICE=1 but ${what} was not found.`);
}

/** One word of a `pdftotext -bbox` page, with the vertical box it fills. */
export interface PdfWordBox {
  yMin: number;
  yMax: number;
  text: string;
}

/**
 * Word boxes per page of a `pdftotext -bbox` XML, in emission order.
 *
 * A regex, not a parser: the file is machine-written, one `<word>` element
 * per line, and a dependency for a shape this fixed would be its own
 * maintenance. Only the vertical box is kept, because the questions asked
 * of these rendered suites are about what sits above what.
 */
export function pdfWordBoxes(xml: string): PdfWordBox[][] {
  return [...xml.matchAll(/<page\b[\s\S]*?<\/page>/g)].map(([page]) =>
    [
      ...page.matchAll(
        /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g
      ),
    ].map(([, , yMin, , yMax, text]) => ({
      yMin: Number(yMin),
      yMax: Number(yMax),
      text,
    }))
  );
}

/**
 * The rows of a page: words that share more than half the shorter box, top
 * down. A number set tight above a display heading overlaps its line box by
 * a point or two without being on its line, which is why the share matters
 * and a bare intersection does not.
 */
export function textRows(words: readonly PdfWordBox[]): PdfWordBox[] {
  const rows: PdfWordBox[] = [];
  for (const w of [...words].sort((a, b) => a.yMin - b.yMin)) {
    const row = rows[rows.length - 1];
    const overlap = row
      ? Math.min(row.yMax, w.yMax) - Math.max(row.yMin, w.yMin)
      : 0;
    if (row && overlap > Math.min(row.yMax - row.yMin, w.yMax - w.yMin) / 2) {
      row.yMax = Math.max(row.yMax, w.yMax);
      row.text += ` ${w.text}`;
    } else rows.push({ yMin: w.yMin, yMax: w.yMax, text: w.text });
  }
  return rows;
}
