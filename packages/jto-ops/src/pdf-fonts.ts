/**
 * Font names from a rendered PDF — the other half of substitution detection.
 *
 * `pdftotext -bbox` says where every word landed but not which face drew it.
 * `pdffonts` (poppler, next to pdftotext) lists every font the PDF embeds or
 * references; LibreOffice embeds the face it actually used, so a requested
 * family that never appears in that list was substituted on the way.
 *
 * Names are PostScript-style: a subset tag (`BAAAAA+`), the family with
 * spaces removed, and a style suffix (`-Bold`, `Medium-Regular`). Comparison
 * therefore happens on a folded form — lowercase alphanumerics only — where
 * "Space Grotesk" and `CAAAAA+SpaceGrotesk-Regular` meet as a prefix match.
 */

import { execFile } from 'child_process';
import * as path from 'path';

/** One font row as `pdffonts` prints it. */
export interface PdfFontInfo {
  /** The name as printed, subset tag included. */
  name: string;
  /** The name without its subset tag: `DMSans-Regular`. */
  baseName: string;
  type: string;
  embedded: boolean;
}

const ROW_PATTERN =
  /^(\S+)\s+(.+?)\s+(\S+)\s+(yes|no)\s+(yes|no)\s+(yes|no)\s+/;

/**
 * Parse `pdffonts` output. Pure; the header and rule lines are skipped and
 * a row that does not fit the column layout is ignored rather than guessed.
 */
export function parsePdfFonts(stdout: string): PdfFontInfo[] {
  const fonts: PdfFontInfo[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith('name ') || line.startsWith('---') || !line.trim()) {
      continue;
    }
    const match = ROW_PATTERN.exec(line);
    if (!match) continue;
    const name = match[1];
    fonts.push({
      name,
      baseName: name.replace(/^[A-Z]{6}\+/, ''),
      type: match[2].trim(),
      embedded: match[4] === 'yes',
    });
  }
  return fonts;
}

/** Lowercase alphanumerics only: the form family names are compared in. */
export function foldFontName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Whether a requested family is present among the rendered fonts. A family
 * matches a PDF font whose folded base name starts with the folded family
 * — `dmsans` against `dmsanslightregular` — so style suffixes never split
 * one family into several.
 */
export function familyRendered(
  family: string,
  fonts: readonly PdfFontInfo[]
): boolean {
  const folded = foldFontName(family);
  if (folded === '') return true;
  return fonts.some((font) => foldFontName(font.baseName).startsWith(folded));
}

function pdffontsCandidates(): string[] {
  const candidates: string[] = [];
  const configured = process.env.PDFFONTS_PATH?.trim();
  if (configured) candidates.push(configured);
  // Poppler ships its tools side by side; a configured pdftotext locates them.
  const sibling = process.env.PDFTOTEXT_PATH?.trim();
  if (sibling) {
    candidates.push(
      path.join(
        path.dirname(sibling),
        process.platform === 'win32' ? 'pdffonts.exe' : 'pdffonts'
      )
    );
  }
  candidates.push('pdffonts');
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
      { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      }
    );
  });
}

let pdffontsPromise: Promise<string> | undefined;
async function resolvePdffonts(): Promise<string> {
  if (!pdffontsPromise) {
    pdffontsPromise = (async () => {
      for (const candidate of pdffontsCandidates()) {
        try {
          await run(candidate, ['-v'], 10_000);
          return candidate;
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code !== 'ENOENT' && code !== 'EACCES') return candidate;
        }
      }
      throw new Error(
        'Font inspection needs pdffonts (poppler), which was not found. ' +
          'Install poppler-utils or set PDFFONTS_PATH ' +
          `(searched: ${pdffontsCandidates().join(', ')}).`
      );
    })().catch((error) => {
      pdffontsPromise = undefined;
      throw error;
    });
  }
  return pdffontsPromise;
}

/** True when a `pdffonts` binary is reachable. */
export async function pdffontsAvailable(): Promise<boolean> {
  try {
    await resolvePdffonts();
    return true;
  } catch {
    return false;
  }
}

/** The fonts a PDF on disk carries. One spawn, stdout only. */
export async function extractPdfFonts(
  pdfPath: string,
  options: { timeoutMs?: number } = {}
): Promise<PdfFontInfo[]> {
  const binary = await resolvePdffonts();
  const stdout = await run(binary, [pdfPath], options.timeoutMs ?? 30_000);
  return parsePdfFonts(stdout);
}
