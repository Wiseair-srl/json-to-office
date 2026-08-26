import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createAdapter } from './format-adapter';
import {
  QUALITY_REFERENCE_CORPUS,
  QUALITY_REFERENCE_DIGESTS,
} from './quality-reference-corpus';

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

describe('maximum-quality reference corpus', () => {
  it('covers poor/professional/excellent for all initial profiles', () => {
    const byProfile = new Map<string, Set<string>>();
    for (const item of QUALITY_REFERENCE_CORPUS) {
      const tiers = byProfile.get(item.profile.id) ?? new Set<string>();
      tiers.add(item.tier);
      byProfile.set(item.profile.id, tiers);
      expect(item.rationale.length).toBeGreaterThan(20);
    }

    expect([...byProfile.keys()].sort()).toEqual([
      'executive-presentation',
      'executive-report',
      'legal-appendix',
      'technical-presentation',
      'technical-report',
    ]);
    for (const tiers of byProfile.values()) {
      expect([...tiers].sort()).toEqual(['excellent', 'poor', 'professional']);
    }
  });

  for (const item of QUALITY_REFERENCE_CORPUS) {
    it(`${item.id} matches its executable verdict`, async () => {
      const adapter = createAdapter(item.format);
      const prepared = await adapter.prepareDocument!(item.document, {
        renderer: item.renderer,
      });
      const analysis = await adapter.analyzeQuality!(item.document, {
        renderer: item.renderer,
        quality: { profile: item.profile },
        prepared,
      });
      const actual = analysis.diagnostics
        .map(({ code, category, certainty }) => ({
          code,
          category,
          certainty,
        }))
        .sort((a, b) => a.code.localeCompare(b.code));
      const expected = [...item.expected].sort((a, b) =>
        a.code.localeCompare(b.code)
      );

      expect(actual).toEqual(expected);
      expect(analysis.profileId).toBe(item.profile.id);
      expect(analysis.ruleErrors).toEqual([]);
      for (const fact of prepared.facts) {
        expect(prepared.provenance[fact.id]?.path).toBe(fact.path);
        expect(fact.path).toMatch(/^(\/[^/]*)*$/);
      }
    });
  }

  it('pins every authored structure', () => {
    expect(Object.keys(QUALITY_REFERENCE_DIGESTS).sort()).toEqual(
      QUALITY_REFERENCE_CORPUS.map(({ id }) => id).sort()
    );
    for (const item of QUALITY_REFERENCE_CORPUS) {
      expect(digest(item.document)).toBe(QUALITY_REFERENCE_DIGESTS[item.id]);
    }
  });
});
