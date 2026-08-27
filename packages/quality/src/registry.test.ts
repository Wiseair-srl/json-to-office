import { describe, expect, it } from 'vitest';
import { DuplicateQualityRuleError, QualityRuleRegistry } from './registry';
import type { QualityRule } from './types';

const rule: QualityRule = {
  id: 'test/rule',
  code: 'W_TEST_RULE',
  category: 'integrity',
  defaultSeverity: 'warning',
  defaultCertainty: 'deterministic',
  formats: ['docx'],
  evaluate: () => [],
};

describe('QualityRuleRegistry', () => {
  it('preserves registration order and filters by format', () => {
    const pptxRule = { ...rule, id: 'test/pptx', formats: ['pptx'] };
    const registry = new QualityRuleRegistry([rule, pptxRule]);

    expect(registry.rules().map((entry) => entry.id)).toEqual([
      'test/rule',
      'test/pptx',
    ]);
    expect(registry.rules('pptx').map((entry) => entry.id)).toEqual([
      'test/pptx',
    ]);
  });

  it('rejects duplicate ids across packs', () => {
    const registry = new QualityRuleRegistry([rule]);
    expect(() =>
      registry.registerPack({ id: 'duplicate', rules: [rule] })
    ).toThrow(DuplicateQualityRuleError);
  });

  it('validates a whole pack before registering any rule', () => {
    const first = { ...rule, id: 'test/first' };
    const registry = new QualityRuleRegistry([rule]);

    expect(() =>
      registry.registerPack({ id: 'not-atomic', rules: [first, rule] })
    ).toThrow(DuplicateQualityRuleError);
    expect(registry.has(first.id)).toBe(false);

    expect(() =>
      registry.registerPack({
        id: 'self-duplicate',
        rules: [first, { ...first }],
      })
    ).toThrow(DuplicateQualityRuleError);
    expect(registry.has(first.id)).toBe(false);
  });
});
