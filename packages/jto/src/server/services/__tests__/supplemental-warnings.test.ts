/**
 * Service-local font warnings must each keep their OWN `context.code`.
 *
 * `overrideWarnings` is one array carrying two different kinds of message —
 * `FONT_OVERRIDE_LOCAL` (a caller-supplied face beat the Google auto-fetch)
 * and `FONT_WEIGHT_NOT_IN_OVERRIDE` (a referenced weight is absent from an
 * upstream override). The mapping to `GenerationWarning` used to hardcode
 * `context: { code: 'FONT_OVERRIDE_LOCAL' }` for every entry, so any client
 * filtering on the code misclassified the second kind.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// `getUpstreamOverride` is mocked to a family whose override advertises only
// weight 300. With the real catalog the FONT_WEIGHT_NOT_IN_OVERRIDE branch is
// unreachable: the only override (Inter) covers 100–900, and the wanted set
// always includes 400, so the variant filter never comes back empty.
vi.mock('@json-to-office/shared', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@json-to-office/shared')>();
  return {
    ...actual,
    getUpstreamOverride: (family: string) =>
      family.toLowerCase() === 'inter'
        ? {
            reason: 'test fixture',
            variants: [
              {
                kind: 'url' as const,
                url: 'https://example.invalid/inter-300.ttf',
                weight: 300,
                italic: false,
              },
            ],
          }
        : undefined,
  };
});

const { autoGoogleFontEntries, toSupplementalWarnings, GeneratorService } =
  await import('../generator');
const { DocxFormatAdapter } = await import('@json-to-office/jto-cli');
const { CacheService } = await import('../cache');

describe('toSupplementalWarnings', () => {
  it('preserves each entry’s own code rather than stamping one on all', () => {
    const mapped = toSupplementalWarnings([
      {
        code: 'FONT_OVERRIDE_LOCAL',
        message: '[FONT_OVERRIDE_LOCAL] Inter: …',
      },
      {
        code: 'FONT_WEIGHT_NOT_IN_OVERRIDE',
        message: 'FONT_WEIGHT_NOT_IN_OVERRIDE: family "Inter" — …',
      },
    ]);
    expect(mapped.map((w) => w.context?.code)).toEqual([
      'FONT_OVERRIDE_LOCAL',
      'FONT_WEIGHT_NOT_IN_OVERRIDE',
    ]);
    // The rest of the client-facing shape is unchanged.
    expect(mapped.every((w) => w.component === 'fontRegistry')).toBe(true);
    expect(mapped.every((w) => w.severity === 'info')).toBe(true);
  });

  it('carries the message through untouched', () => {
    const message = 'FONT_WEIGHT_NOT_IN_OVERRIDE: family "Inter" — weight 250';
    expect(
      toSupplementalWarnings([
        { code: 'FONT_WEIGHT_NOT_IN_OVERRIDE', message },
      ])[0].message
    ).toBe(message);
  });
});

describe('autoGoogleFontEntries warning codes', () => {
  it('emits FONT_WEIGHT_NOT_IN_OVERRIDE as a structured, self-coded warning', () => {
    const warnings: Array<{ code: string; message: string }> = [];
    const entries = autoGoogleFontEntries(
      new Set(['Inter']),
      new Set(),
      // 250 is absent from the (mocked) override, and so is the implicit 400 —
      // the filter comes back empty and the fallback warning fires.
      new Set([250]),
      false,
      warnings
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe('FONT_WEIGHT_NOT_IN_OVERRIDE');
    expect(warnings[0].message).toContain('FONT_WEIGHT_NOT_IN_OVERRIDE');
    // The fallback still fetches every override variant.
    expect(entries[0].sources).toHaveLength(1);
  });

  it('keeps a message that survives the mapping with its own code', () => {
    const warnings: Array<{ code: string; message: string }> = [];
    autoGoogleFontEntries(
      new Set(['Inter']),
      new Set(),
      new Set([250]),
      false,
      warnings
    );
    const mapped = toSupplementalWarnings(warnings);
    expect(mapped[0].context?.code).toBe('FONT_WEIGHT_NOT_IN_OVERRIDE');
  });
});

describe('FONT_OVERRIDE_LOCAL end-to-end', () => {
  let cache: InstanceType<typeof CacheService>;
  let service: InstanceType<typeof GeneratorService>;

  beforeEach(() => {
    cache = new CacheService();
    service = new GeneratorService(new DocxFormatAdapter(), cache);
  });
  afterEach(() => {
    service.destroy();
    cache.destroy();
  });

  /** Minimal but structurally real TTF: an sfnt header with zero tables. */
  function fakeTtfBase64(): string {
    const buf = Buffer.alloc(12);
    buf.writeUInt32BE(0x00010000, 0);
    buf.writeUInt16BE(0, 4);
    return buf.toString('base64');
  }

  it('still reaches the client with its own code', async () => {
    const result = await service.generate({
      jsonDefinition: {
        name: 'docx',
        props: { theme: 'minimal', metadata: { title: 'override-local' } },
        children: [
          {
            name: 'paragraph',
            props: { text: 'Body.', font: { family: 'Inter' } },
          },
        ],
      },
      options: {
        fonts: {
          extraEntries: [
            {
              id: 'inter-local',
              family: 'Inter',
              sources: [{ kind: 'data', data: fakeTtfBase64(), weight: 400 }],
            },
          ],
        },
      },
    });

    const hit = (result.warnings ?? []).find(
      (w) => w.context?.code === 'FONT_OVERRIDE_LOCAL'
    );
    expect(hit).toBeDefined();
    expect(hit!.message).toContain('Inter');
    expect(hit!.severity).toBe('info');
  });
});
