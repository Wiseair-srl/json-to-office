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
