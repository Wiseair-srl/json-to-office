import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createAdapter } from './format-adapter';
import {
  QUALITY_REFERENCE_CORPUS,
  QUALITY_REFERENCE_CROSS_PROFILE,
  QUALITY_REFERENCE_DIGESTS,
  type ExpectedQualityDiagnostic,
  type QualityReferenceCase,
} from './quality-reference-corpus';
import type { QualityProfile } from '@json-to-office/quality';

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** RFC 6901 resolve; `undefined` when the pointer addresses nothing. */
function resolvePointer(document: unknown, pointer: string): unknown {
  if (pointer === '') return document;
  let node: unknown = document;
  for (const token of pointer.slice(1).split('/')) {
    if (node === null || typeof node !== 'object') return undefined;
    const key = token.replace(/~1/g, '/').replace(/~0/g, '~');
    node = (node as Record<string, unknown>)[key];
    if (node === undefined) return undefined;
  }
  return node;
}

function sortByCode(expected: readonly ExpectedQualityDiagnostic[]) {
  return [...expected].sort((a, b) => a.code.localeCompare(b.code));
}

async function verdict(item: QualityReferenceCase, profile: QualityProfile) {
  const adapter = createAdapter(item.format);
  const prepared = await adapter.prepareDocument!(item.document, {
    renderer: item.renderer,
  });
  const analysis = await adapter.analyzeQuality!(item.document, {
    renderer: item.renderer,
    quality: { profile },
    prepared,
  });
  return {
    prepared,
    analysis,
    actual: sortByCode(
      analysis.diagnostics.map(({ code, category, certainty, severity }) => ({
        code,
        category,
        certainty,
        severity,
      }))
    ),
  };
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
      'consulting-deck',
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
      const { prepared, analysis, actual } = await verdict(item, item.profile);

      expect(actual).toEqual(sortByCode(item.expected));
      expect(analysis.profileId).toBe(item.profile.id);
      expect(analysis.ruleErrors).toEqual([]);
      for (const fact of prepared.facts) {
        const reference = prepared.provenance[fact.id];
        expect(reference).toBeDefined();
        expect(fact.path).toMatch(/^(\/[^/]*)*$/);
        // A pointer that addresses nothing is provenance in name only.
        expect(resolvePointer(item.document, reference!.path)).toBeDefined();
      }
    });
  }

  for (const pair of QUALITY_REFERENCE_CROSS_PROFILE) {
    it(`${pair.caseId} reads differently under ${pair.profile.id}`, async () => {
      const item = QUALITY_REFERENCE_CORPUS.find(
        ({ id }) => id === pair.caseId
      );
      expect(item).toBeDefined();

      const { analysis, actual } = await verdict(item!, pair.profile);

      expect(actual).toEqual(sortByCode(pair.expected));
      expect(actual).not.toEqual(sortByCode(item!.expected));
      expect(analysis.profileId).toBe(pair.profile.id);
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
