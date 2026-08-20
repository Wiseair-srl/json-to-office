/**
 * Core generation warnings (FONT_UNRESOLVED and friends) must reach the
 * playground. Two things used to swallow them:
 *
 * 1. The jto-cli FormatAdapter routed them into `emitDiagnostic`, an
 *    AsyncLocalStorage sink that is a no-op off the CLI.
 * 2. Even once collected, `CacheService` stored bare Buffers, so the second
 *    render of the same document returned `warnings: null`.
 *
 * The family used here is deliberately absent from POPULAR_GOOGLE_FONTS: a
 * catalog family (Geist and Inter among them) is auto-registered as
 * `fonts.extraEntries`, which both resolves the reference and forces
 * `bypassCache` — the cache-hit assertion would pass vacuously.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { GenerationWarning } from '@json-to-office/shared';
import { DocxFormatAdapter } from '@json-to-office/jto-cli';
import { GeneratorService } from '../generator';
import { CacheService } from '../cache';

const UNKNOWN_FAMILY = 'Acme Brand Sans';

function report(props: Record<string, unknown>, title: string) {
  return {
    name: 'docx',
    props: { theme: 'minimal' },
    metadata: { title },
    children: [{ name: 'paragraph', props: { text: 'Body.', ...props } }],
  };
}

const unresolved = (warnings: GenerationWarning[] | null | undefined) =>
  (warnings ?? []).filter((w) => w.context?.code === 'FONT_UNRESOLVED');

describe('GeneratorService warning propagation', () => {
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

  it('returns core FONT_UNRESOLVED warnings in the client-facing shape', async () => {
    const result = await service.generate({
      jsonDefinition: report(
        { font: { family: UNKNOWN_FAMILY } },
        'unresolved-shape'
      ),
    });

    const hits = unresolved(result.warnings);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].component).toBe('fontRegistry');
    expect(hits[0].message).toContain(UNKNOWN_FAMILY);
    expect(['warning', 'info']).toContain(hits[0].severity);
  });

  it('orders core warnings before the service-local extras', async () => {
    const result = await service.generate({
      jsonDefinition: report(
        { font: { family: UNKNOWN_FAMILY, fontWeight: 450 } },
        'ordering'
      ),
    });

    const codes = (result.warnings ?? []).map((w) => w.context?.code);
    expect(codes).toContain('FONT_UNRESOLVED');
    expect(codes).toContain('FONT_NONCANONICAL_WEIGHT');
    expect(codes.indexOf('FONT_UNRESOLVED')).toBeLessThan(
      codes.indexOf('FONT_NONCANONICAL_WEIGHT')
    );
  });

  it('keeps the warnings on a cache hit', async () => {
    const definition = report(
      { font: { family: UNKNOWN_FAMILY } },
      'cache-hit'
    );

    const first = await service.generate({ jsonDefinition: definition });
    const second = await service.generate({ jsonDefinition: definition });

    // Precondition: this document must actually take the cache path,
    // otherwise the assertion below proves nothing.
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.warnings).toEqual(first.warnings);
    expect(unresolved(second.warnings).length).toBeGreaterThan(0);
  });

  it('returns null rather than an empty array when nothing warned', async () => {
    const result = await service.generate({
      jsonDefinition: report({}, 'clean'),
    });

    expect(result.warnings).toBeNull();
  });

  it('caches a null warnings field without turning it into an array', async () => {
    const definition = report({}, 'clean-cached');

    await service.generate({ jsonDefinition: definition });
    const second = await service.generate({ jsonDefinition: definition });

    expect(second.cached).toBe(true);
    expect(second.warnings).toBeNull();
  });
});
