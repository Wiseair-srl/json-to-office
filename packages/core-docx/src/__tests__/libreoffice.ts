/**
 * Where the rendering tests find LibreOffice, pdftotext and pdftoppm.
 *
 * Suites that need them skip themselves when a tool is missing, so no test
 * run depends on a GUI application being installed; `JTO_REQUIRE_LIBREOFFICE=1`
 * turns a missing tool into a failure where CI guarantees it.
 */
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
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

export async function hasPdftoppm(): Promise<boolean> {
  try {
    await run('pdftoppm', ['-v'], { timeout: 10_000 });
    return true;
  } catch (error) {
    // Some poppler builds exit non-zero for `-v`; only a missing or
    // unusable binary means there is none.
    const code = (error as NodeJS.ErrnoException).code;
    return code !== 'ENOENT' && code !== 'EACCES';
  }
}

/** Throws when the environment insists on the tools and one is missing. */
export function requireIfInsisted(found: boolean, what: string): void {
  if (process.env.JTO_REQUIRE_LIBREOFFICE === '1' && !found)
    throw new Error(`JTO_REQUIRE_LIBREOFFICE=1 but ${what} was not found.`);
}

/** One word of a `pdftotext -bbox` page, with the box it fills, in points. */
export interface PdfWordBox {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  text: string;
}

/**
 * Word boxes per page of a `pdftotext -bbox` XML, in emission order.
 *
 * A regex, not a parser: the file is machine-written, one `<word>` element
 * per line, and a dependency for a shape this fixed would be its own
 * maintenance. The questions asked of these rendered suites are about what
 * sits above what, and what starts where something else does.
 */
export function pdfWordBoxes(xml: string): PdfWordBox[][] {
  return [...xml.matchAll(/<page\b[\s\S]*?<\/page>/g)].map(([page]) =>
    [
      ...page.matchAll(
        /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g
      ),
    ].map(([, xMin, yMin, xMax, yMax, text]) => ({
      xMin: Number(xMin),
      xMax: Number(xMax),
      yMin: Number(yMin),
      yMax: Number(yMax),
      text,
    }))
  );
}

/** Each page's size in points, from the same `pdftotext -bbox` XML. */
export function pdfPageSizes(
  xml: string
): Array<{ width: number; height: number }> {
  return [...xml.matchAll(/<page width="([\d.]+)" height="([\d.]+)">/g)].map(
    ([, width, height]) => ({
      width: Number(width),
      height: Number(height),
    })
  );
}

/** A page rendered to 8-bit grey, row by row, 255 being white. */
export interface GrayPage {
  width: number;
  height: number;
  pixels: Uint8Array;
}

/**
 * One page of a PDF rasterized in grey by pdftoppm, for what text geometry
 * cannot say: whether a rule was drawn. The PGM it writes is an ASCII header
 * and then one byte per pixel, so reading it needs no image library.
 */
export async function pdfPageGray(
  pdf: string,
  page: number,
  dpi: number
): Promise<GrayPage> {
  const prefix = pdf.replace(/\.pdf$/, `-page${page}`);
  await run(
    'pdftoppm',
    [
      '-gray',
      '-r',
      String(dpi),
      '-f',
      String(page),
      '-l',
      String(page),
      '-singlefile',
      pdf,
      prefix,
    ],
    { timeout: 60_000 }
  );
  const bytes = await readFile(`${prefix}.pgm`);
  const header = /^P5\s+(\d+)\s+(\d+)\s+255\s/.exec(
    bytes.subarray(0, 64).toString('latin1')
  );
  if (!header) throw new Error(`${prefix}.pgm is not an 8-bit binary PGM`);
  const [width, height] = [Number(header[1]), Number(header[2])];
  return {
    width,
    height,
    pixels: bytes.subarray(header[0].length, header[0].length + width * height),
  };
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
      row.xMin = Math.min(row.xMin, w.xMin);
      row.xMax = Math.max(row.xMax, w.xMax);
      row.yMax = Math.max(row.yMax, w.yMax);
      row.text += ` ${w.text}`;
    } else rows.push({ ...w });
  }
  return rows;
}
