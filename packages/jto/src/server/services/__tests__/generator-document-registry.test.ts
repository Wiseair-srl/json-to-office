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
import { readFileSync } from 'node:fs';
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
