/**
 * The playground's rule table against the rule packs it mirrors.
 *
 * `quality-rules.ts` has asked to be kept in step with the two packs since it
 * was written, and asking was not enough: nine rules shipped without an entry.
 * The cost was not only the missing completion. `parseQualityPolicy` refuses
 * any rule id the table does not list, so a policy naming one of the nine was
 * rejected in the editor and never reached the server — the last case below
 * pins that, since it is the one a user actually hits.
 *
 * The client bundle already imports `@json-to-office/core-docx` (the plugin
 * templates do), so reading the packs here costs nothing it was not paying.
 */

import { describe, expect, it, vi } from 'vitest';
import { DOCX_QUALITY_RULES } from '@json-to-office/core-docx';
import { PPTX_QUALITY_RULES } from '@json-to-office/core-pptx';
import type { QualityRule, QualityRulePack } from '@json-to-office/quality';
import { QUALITY_RULES, type QualityRuleInfo } from '../quality-rules';
import type { FormatName } from '../env';

type AnyRule = QualityRule<unknown, never>;

const PACKS: Record<FormatName, QualityRulePack<never, never>> = {
  docx: DOCX_QUALITY_RULES as unknown as QualityRulePack<never, never>,
  pptx: PPTX_QUALITY_RULES as unknown as QualityRulePack<never, never>,
};

const FORMATS: readonly FormatName[] = ['docx', 'pptx'];

function mirrored(format: FormatName): readonly QualityRuleInfo[] {
  return QUALITY_RULES[format];
}

function packed(format: FormatName): readonly AnyRule[] {
  return PACKS[format].rules as readonly AnyRule[];
}

function parametersOf(rule: AnyRule): Readonly<Record<string, unknown>> {
  return rule.defaultParameters ?? {};
}

describe.each(FORMATS)('%s rule mirror', (format) => {
  it('lists every shipped rule, in the pack’s own order', () => {
    // Order too, not just membership: the two files are read side by side when
    // a rule is added, and a shuffled list hides what is missing.
    expect(mirrored(format).map((rule) => rule.id)).toEqual(
      packed(format).map((rule) => rule.id)
    );
  });

  it('agrees on category and default severity', () => {
    const fromPack = packed(format).map((rule) => ({
      id: rule.id,
      category: rule.category,
      defaultSeverity: rule.defaultSeverity,
    }));
    expect(
      mirrored(format).map(({ id, category, defaultSeverity }) => ({
        id,
        category,
        defaultSeverity,
      }))
    ).toEqual(fromPack);
  });

  it('lists every tunable parameter, with the default the rule actually uses', () => {
    for (const rule of packed(format)) {
      const entry = mirrored(format).find((info) => info.id === rule.id);
      expect(entry, `${rule.id} is not mirrored`).toBeDefined();

      const parameters = parametersOf(rule);
      expect(
        entry!.parameters.map((parameter) => parameter.name).sort(),
        `${rule.id} parameter names`
      ).toEqual(Object.keys(parameters).sort());

      for (const [name, value] of Object.entries(parameters)) {
        // The mirror can only describe numbers. A rule that grows a parameter
        // of another type has to widen `QualityRuleParameter` first, and this
        // is where it finds out rather than silently going undocumented.
        expect(
          typeof value,
          `${rule.id}.${name} is not a number; widen QualityRuleParameter`
        ).toBe('number');
        expect(
          entry!.parameters.find((parameter) => parameter.name === name)
            ?.default,
          `${rule.id}.${name} default`
        ).toBe(value);
      }
    }
  });

  it('says something about every rule and every parameter', () => {
    for (const rule of mirrored(format)) {
      expect(rule.label.length, `${rule.id} label`).toBeGreaterThan(0);
      expect(rule.description.length, `${rule.id} description`).toBeGreaterThan(
        10
      );
      for (const parameter of rule.parameters) {
        expect(
          parameter.description.length,
          `${rule.id}.${parameter.name} description`
        ).toBeGreaterThan(10);
      }
    }
  });
});

describe('a policy may name any rule the format ships', () => {
  // The editor validates against the mirror, so an unlisted rule is not a
  // missing hint but a refusal: `pptx/box-overlap` used to come back
  // `Unknown rule "pptx/box-overlap"` from a policy that was perfectly valid.
  it.each(FORMATS)('%s', async (format) => {
    vi.resetModules();
    vi.doMock('../env', async () => ({
      ...(await vi.importActual<typeof import('../env')>('../env')),
      FORMAT: format,
    }));
    const { parseQualityPolicy } = await import('../quality-policy');

    for (const rule of packed(format)) {
      const text = JSON.stringify({ rules: { [rule.id]: { enabled: false } } });
      expect(parseQualityPolicy(text), rule.id).toMatchObject({ ok: true });
    }
    vi.doUnmock('../env');
  });
});

describe('the mirror covers both formats', () => {
  it('keys nothing but the shipped formats', () => {
    expect(Object.keys(QUALITY_RULES).sort()).toEqual([...FORMATS].sort());
  });

  it('gives a rule id to exactly one format', () => {
    // A shared id would make `rulesForFormat` ambiguous and the editor's
    // completion wrong for one of the two.
    const ids = FORMATS.flatMap((format) =>
      mirrored(format).map((rule) => rule.id)
    );
    expect(new Set(ids).size).toBe(ids.length);
  });
});
