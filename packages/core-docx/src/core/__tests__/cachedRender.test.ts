/**
 * Cache observability + keying behavior of renderComponentWithCache (#156):
 * - design bypasses are counted per type with a reason;
 * - the generation date only joins the cache key for components that
 *   reference a date-sensitive placeholder, so date-less components hit
 *   across renders.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  renderComponentWithCache,
  getComponentCache,
  getComponentCacheStats,
  getComponentBypassStats,
  clearComponentCache,
  usesDateSensitivePlaceholder,
} from '../cached-render';
import { runWithGenerationDate } from '../../utils/generationContext';
import { ensureThemeDefaults } from '../../themes/defaults';
import type { RenderContext } from '../../types';

const theme = ensureThemeDefaults({
  name: 'test',
  displayName: 'Test Theme',
  description: 'Theme for cache tests',
});

const context = {} as RenderContext;

describe('usesDateSensitivePlaceholder', () => {
  it('detects date-sensitive placeholders case-insensitively', () => {
    expect(usesDateSensitivePlaceholder('{"text":"Built {DATE}"}')).toBe(true);
    expect(usesDateSensitivePlaceholder('{"text":"{date}"}')).toBe(true);
    expect(usesDateSensitivePlaceholder('{"text":"© {YEAR}"}')).toBe(true);
    expect(usesDateSensitivePlaceholder('{"text":"{DATETIME}"}')).toBe(true);
  });

  it('ignores field codes, unregistered names, and plain text', () => {
    expect(usesDateSensitivePlaceholder('{"text":"p. {PAGE}"}')).toBe(false);
    expect(usesDateSensitivePlaceholder('{"text":"{TOTAL_PAGES}"}')).toBe(
      false
    );
    expect(usesDateSensitivePlaceholder('{"text":"{NOT_A_PLACEHOLDER}"}')).toBe(
      false
    );
    expect(usesDateSensitivePlaceholder('{"text":"no placeholders"}')).toBe(
      false
    );
  });
});

describe('component bypass stats', () => {
  beforeEach(async () => {
    await clearComponentCache();
  });

  it('counts design-bypassed renders per type with a reason', async () => {
    await renderComponentWithCache(
      { name: 'paragraph', props: { text: 'hello' } },
      theme,
      'test',
      context
    );
    await renderComponentWithCache(
      { name: 'paragraph', props: { text: 'world' } },
      theme,
      'test',
      context
    );
    await renderComponentWithCache(
      { name: 'heading', props: { level: 1, text: 'title' } },
      theme,
      'test',
      context
    );

    const stats = getComponentBypassStats();
    const byType = Object.fromEntries(stats.map((s) => [s.type, s]));
    expect(byType.paragraph).toMatchObject({
      renders: 2,
      reason: 'dynamic-context',
    });
    expect(byType.heading).toMatchObject({
      renders: 1,
      reason: 'dynamic-context',
    });
  });

  it('reports id-bearing components with the bookmark-id reason', async () => {
    await renderComponentWithCache(
      { name: 'statistic', id: 'anchor', props: { number: '42' } } as any,
      theme,
      'test',
      context
    );
    const stats = getComponentBypassStats();
    expect(stats.find((s) => s.type === 'statistic')).toMatchObject({
      renders: 1,
      reason: 'bookmark-id',
    });
  });

  it('exposes bypass stats through getComponentCacheStats and resets on clear', async () => {
    await renderComponentWithCache(
      { name: 'paragraph', props: { text: 'x' } },
      theme,
      'test',
      context
    );
    const stats = getComponentCacheStats() as any;
    expect(stats.bypassedComponents).toEqual([
      { type: 'paragraph', renders: 1, reason: 'dynamic-context' },
    ]);

    await clearComponentCache();
    expect(getComponentBypassStats()).toEqual([]);
  });
});

describe('generation-date cache keying', () => {
  beforeEach(async () => {
    await clearComponentCache();
  });

  it('date-less components hit across renders with different dates', async () => {
    const component = { name: 'statistic', props: { number: '42' } };

    await runWithGenerationDate(new Date('2026-01-01T10:00:00Z'), () =>
      renderComponentWithCache(component, theme, 'test', context)
    );
    await runWithGenerationDate(new Date('2026-01-02T10:00:00Z'), () =>
      renderComponentWithCache(component, theme, 'test', context)
    );

    const stats = getComponentCache()!.getStats();
    expect(stats.totalHits).toBe(1);
    expect(stats.totalMisses).toBe(1);
  });

  it('date-sensitive components still miss across dates', async () => {
    const component = {
      name: 'statistic',
      props: { number: '42', description: 'as of {DATE}' },
    };

    await runWithGenerationDate(new Date('2026-01-01T10:00:00Z'), () =>
      renderComponentWithCache(component, theme, 'test', context)
    );
    await runWithGenerationDate(new Date('2026-01-02T10:00:00Z'), () =>
      renderComponentWithCache(component, theme, 'test', context)
    );

    const stats = getComponentCache()!.getStats();
    expect(stats.totalHits).toBe(0);
    expect(stats.totalMisses).toBe(2);
  });

  it('date-sensitive components hit within the same generation date', async () => {
    const component = {
      name: 'statistic',
      props: { number: '7', description: 'as of {DATE}' },
    };

    await runWithGenerationDate(new Date('2026-03-03T09:00:00Z'), async () => {
      await renderComponentWithCache(component, theme, 'test', context);
      await renderComponentWithCache(component, theme, 'test', context);
    });

    const stats = getComponentCache()!.getStats();
    expect(stats.totalHits).toBe(1);
    expect(stats.totalMisses).toBe(1);
  });
});
