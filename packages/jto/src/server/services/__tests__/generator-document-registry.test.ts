/**
 * A font declared only by `props.fontRegistry` must actually materialize.
 *
 * GeneratorService builds `fontOpts` — and therefore registers the
 * `onResolved` side-channel that feeds the LibreOffice preview stager — only
 * when it can see a reason to. A document-declared registry has no
 * representation in `options.fonts.extraEntries`, so it used to fall through
 * every branch: `resolveDocumentFonts` short-circuited, `resolvedFonts` came
 * back empty, and an uploaded font was validated but rendered with a host
 * fallback. That is the whole feature, silently inert.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DocxFormatAdapter } from '@json-to-office/jto-cli';
import { GeneratorService } from '../generator';
import { CacheService } from '../cache';

const FAMILY = 'Acme Brand Sans';

/**
 * A real font, registered under a family name of its own.
 *
 * An sfnt header with zero tables used to stand in here — enough for the data
 * loader's magic-byte sniff, which was all the pipeline looked at. It isn't a
 * font a font system could load, and `validateFontStructure` now says so, so
 * the stand-in would have this suite asserting the absence of a warning the
 * pipeline is right to emit. Real bytes also mean the resolution path under
 * test runs end to end, family stamp included.
 *
 * Weight 500 because the fixture is a Medium: registering it as anything else
 * trips the metadata checks on a question this suite isn't asking.
 */
const REAL_TTF = readFileSync(
  path.resolve(
    __dirname,
    '../../../../../core-docx/src/styles/fonts/life-sans/LifeSans-Medium.ttf'
  )
);
const FIXTURE_WEIGHT = 500;

const docWithRegistry = () => ({
  name: 'docx',
  props: {
    theme: 'minimal',
    fontRegistry: [
      {
        id: 'acme',
        family: FAMILY,
        category: 'sans',
        sources: [
          {
            kind: 'data',
            data: REAL_TTF.toString('base64'),
            weight: FIXTURE_WEIGHT,
          },
        ],
      },
    ],
    metadata: { title: 'registry-materialization' },
  },
  children: [
    { name: 'paragraph', props: { text: 'Body.', font: { family: FAMILY } } },
  ],
});

describe('props.fontRegistry materialization', () => {
  let cache: CacheService;
  let service: GeneratorService;

  beforeEach(() => {
    cache = new CacheService();
    service = new GeneratorService(new DocxFormatAdapter(), cache);
  });
  afterEach(() => {
    cache.destroy();
  });

  it('resolves a family declared only by the document registry', async () => {
    const result = await service.generate({
      jsonDefinition: docWithRegistry(),
      options: { bypassCache: true },
    });
    // Non-empty is the point: this is what /preview/libreoffice-from-json
    // hands to the font stager.
    expect(result.resolvedFonts?.length).toBeGreaterThan(0);
    expect(result.resolvedFonts?.some((f) => f.family === FAMILY)).toBe(true);
  });

  it('does not report the registered family as unresolved', async () => {
    const result = await service.generate({
      jsonDefinition: docWithRegistry(),
      options: { bypassCache: true },
    });
    const unresolved = (result.warnings ?? []).filter(
      (w) => w?.context?.code === 'FONT_UNRESOLVED'
    );
    expect(unresolved).toEqual([]);
  });

  it('leaves a document with no registry and no custom fonts alone', async () => {
    // The gate must stay narrow: a safe-font document should not start
    // constructing registries or resolving anything.
    const result = await service.generate({
      jsonDefinition: {
        name: 'docx',
        props: { theme: 'minimal', metadata: { title: 'safe-only' } },
        children: [
          {
            name: 'paragraph',
            props: { text: 'Body.', font: { family: 'Arial' } },
          },
        ],
      },
      options: { bypassCache: true },
    });
    expect(result.resolvedFonts ?? []).toEqual([]);
  });
});

describe('a declared registry bypasses the buffer cache', () => {
  let cache: CacheService;
  let service: GeneratorService;

  beforeEach(() => {
    cache = new CacheService();
    service = new GeneratorService(new DocxFormatAdapter(), cache);
  });
  afterEach(() => {
    cache.destroy();
  });

  it('still returns resolvedFonts on a repeat render', async () => {
    // The byte cache cannot round-trip the resolvedFonts side-channel, so a
    // cache hit would hand the preview a buffer with nothing to stage and the
    // font would silently fall back on every render after the first.
    const first = await service.generate({ jsonDefinition: docWithRegistry() });
    expect(first.resolvedFonts?.length).toBeGreaterThan(0);

    const second = await service.generate({
      jsonDefinition: docWithRegistry(),
    });
    expect(second.cached).toBe(false);
    expect(second.resolvedFonts?.length).toBeGreaterThan(0);
  });
});

describe('kind:"file" sources resolve against options.baseDir', () => {
  // The routes map a discovered document's sourceName to its directory and
  // hand it over as `options.baseDir`. FontRegistry reads `fonts.baseDir`
  // only, so a relative font path in the theme or document used to resolve
  // against the server's cwd and come back FONT_UNRESOLVED (no fonts in the
  // preview, none embedded in `embed` mode).
  let cache: CacheService;
  let service: GeneratorService;
  let baseDir: string;

  beforeEach(() => {
    cache = new CacheService();
    service = new GeneratorService(new DocxFormatAdapter(), cache);
    baseDir = mkdtempSync(path.join(tmpdir(), 'jto-font-basedir-'));
    mkdirSync(path.join(baseDir, 'fonts'));
    writeFileSync(path.join(baseDir, 'fonts', 'acme.ttf'), REAL_TTF);
  });
  afterEach(() => {
    cache.destroy();
    rmSync(baseDir, { recursive: true, force: true });
  });

  const fileEntry = {
    id: 'acme',
    family: FAMILY,
    category: 'sans',
    sources: [{ kind: 'file', path: 'fonts/acme.ttf', weight: FIXTURE_WEIGHT }],
  };

  const expectResolved = (
    result: Awaited<ReturnType<GeneratorService['generate']>>
  ) => {
    expect(result.resolvedFonts?.some((f) => f.family === FAMILY)).toBe(true);
    expect(
      (result.warnings ?? []).filter(
        (w) => w?.context?.code === 'FONT_UNRESOLVED'
      )
    ).toEqual([]);
  };

  it('resolves a relative path in a custom theme registry', async () => {
    const minimal = JSON.parse(
      readFileSync(
        path.resolve(
          __dirname,
          '../../../../../core-docx/src/templates/themes/minimal.docx.theme.json'
        ),
        'utf8'
      )
    );
    const theme = {
      ...minimal,
      name: 'acme',
      fonts: { ...minimal.fonts, heading: { family: FAMILY, size: 21 } },
      fontRegistry: [fileEntry],
    };
    const result = await service.generate({
      jsonDefinition: {
        name: 'docx',
        props: { theme: 'acme', metadata: { title: 'theme-file-font' } },
        children: [{ name: 'heading', props: { text: 'Title', level: 1 } }],
      },
      customThemes: { acme: theme },
      options: { bypassCache: true, baseDir },
    });
    expectResolved(result);
  });

  it('resolves a relative path in the document registry', async () => {
    const result = await service.generate({
      jsonDefinition: {
        name: 'docx',
        props: {
          theme: 'minimal',
          fontRegistry: [fileEntry],
          metadata: { title: 'document-file-font' },
        },
        children: [
          {
            name: 'paragraph',
            props: { text: 'Body.', font: { family: FAMILY } },
          },
        ],
      },
      options: { bypassCache: true, baseDir },
    });
    expectResolved(result);
  });
});
