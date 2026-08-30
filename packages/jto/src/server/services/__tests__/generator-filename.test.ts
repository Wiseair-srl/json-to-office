/**
 * The returned `filename` is built from the document's own title, which is
 * arbitrary user text. It does not stay inside the process: the generate
 * response carries it, and `/preview/*-from-json` interpolates it straight
 * into a `Content-Disposition` header. #292 is what made this reachable —
 * before it the title was read from a root-level `metadata.title` that was
 * never part of either schema, so every real document fell back to the
 * adapter label and no user text ever reached the filename.
 *
 * The LibreOffice converter's `sanitizeBaseName` protects only the temp path
 * it builds for itself, so it never covered this value.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DocxFormatAdapter } from '@json-to-office/jto-cli';
import { GeneratorService } from '../generator';
import { CacheService } from '../cache';

function report(title: unknown) {
  return {
    name: 'docx',
    props: { theme: 'minimal', metadata: { title } },
    children: [{ name: 'paragraph', props: { text: 'Body.' } }],
  };
}

describe('GeneratorService filename construction', () => {
  let cache: CacheService;
  let service: GeneratorService;

  beforeEach(() => {
    cache = new CacheService();
    service = new GeneratorService(new DocxFormatAdapter(), cache);
  });

  afterEach(() => {
    service.destroy();
    cache.destroy();
  });

  const filenameFor = async (title: unknown) =>
    (await service.generate({ jsonDefinition: report(title) })).filename;

  it('keeps an ordinary title readable', async () => {
    expect(await filenameFor('Annual Report 2026')).toBe(
      'Annual_Report_2026.docx'
    );
  });

  it('strips path separators', async () => {
    const filename = await filenameFor('../../etc/passwd');
    expect(filename).not.toMatch(/[/\\]/);
    expect(filename).toBe('.._.._etc_passwd.docx');
  });

  it('strips control characters that would split the header', async () => {
    // The sharp end: a raw CRLF here ends Content-Disposition and starts an
    // attacker-chosen header.
    const filename = await filenameFor(
      'ok\r\nX-Injected: yes\r\n\r\n<script>alert(1)</script>'
    );
    expect(filename).not.toMatch(/[\r\n]/);
    // Nothing that could terminate or re-open the quoted filename either.
    expect(filename).not.toMatch(/["'<>;]/);
  });

  it('caps an overlong title', async () => {
    const filename = await filenameFor('A'.repeat(5000));
    expect(filename.length).toBeLessThanOrEqual(105);
    expect(filename.endsWith('.docx')).toBe(true);
  });

  it('falls back to the adapter label when nothing survives sanitizing', async () => {
    // "../.." is all separators and dots — sanitizing leaves no name, and
    // emitting `...docx` would be worse than the label.
    expect(await filenameFor('../..')).toBe('document.docx');
    expect(await filenameFor('///')).toBe('document.docx');
  });

  it('falls back to the adapter label when the title is absent', async () => {
    expect(await filenameFor(undefined)).toBe('document.docx');
  });

  it('never sees a non-string title — the schema rejects it first', async () => {
    // `documentTitle`'s typeof check is the second line; this is the first.
    // Pinned so a schema loosening shows up here rather than as a surprise
    // `[object Object].docx`.
    await expect(
      service.generate({ jsonDefinition: report(42) })
    ).rejects.toThrow(/validation failed/i);
  });

  it('sanitizes on the cache-hit branch too', async () => {
    // Two filename branches exist — the cached return and the generated one.
    // A fix applied to only one of them leaves the second render exposed.
    const definition = report('../../etc/passwd');
    const first = await service.generate({ jsonDefinition: definition });
    const second = await service.generate({ jsonDefinition: definition });

    expect(second.cached).toBe(true);
    expect(second.filename).toBe(first.filename);
    expect(second.filename).not.toMatch(/[/\\]/);
  });
});
