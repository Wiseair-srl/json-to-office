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
import { DocxFormatAdapter } from '@json-to-office/jto-cli';
import { GeneratorService } from '../generator';
import { CacheService } from '../cache';

const FAMILY = 'Acme Brand Sans';

/**
 * A minimal but structurally real TTF: an sfnt header with zero tables. Enough
 * for the data loader's magic-byte sniff, and it keeps the fixture inline.
 */
function fakeTtfBase64(): string {
  const buf = Buffer.alloc(12);
  buf.writeUInt32BE(0x00010000, 0); // sfnt version
  buf.writeUInt16BE(0, 4); // numTables
  return buf.toString('base64');
}

const docWithRegistry = () => ({
  name: 'docx',
  props: {
    theme: 'minimal',
    fontRegistry: [
      {
        id: 'acme',
        family: FAMILY,
        category: 'sans',
        sources: [{ kind: 'data', data: fakeTtfBase64(), weight: 400 }],
      },
    ],
  },
  metadata: { title: 'registry-materialization' },
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
        props: { theme: 'minimal' },
        metadata: { title: 'safe-only' },
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
