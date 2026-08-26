import type { QualityFact, QualityRule, QualityRulePack } from './types';

export class DuplicateQualityRuleError extends Error {
  constructor(ruleId: string) {
    super(`Quality rule "${ruleId}" is already registered`);
    this.name = 'DuplicateQualityRuleError';
  }
}

export class QualityRuleRegistry<
  TModel = unknown,
  TFact extends QualityFact = QualityFact,
> {
  private readonly entries = new Map<string, QualityRule<TModel, TFact>>();

  constructor(rules: Iterable<QualityRule<TModel, TFact>> = []) {
    for (const rule of rules) this.register(rule);
  }

  register(rule: QualityRule<TModel, TFact>): this {
    if (this.entries.has(rule.id)) {
      throw new DuplicateQualityRuleError(rule.id);
    }
    this.entries.set(rule.id, rule);
    return this;
  }

  registerPack(pack: QualityRulePack<TModel, TFact>): this {
    for (const rule of pack.rules) this.register(rule);
    return this;
  }

  has(ruleId: string): boolean {
    return this.entries.has(ruleId);
  }

  get(ruleId: string): QualityRule<TModel, TFact> | undefined {
    return this.entries.get(ruleId);
  }

  rules(format?: string): readonly QualityRule<TModel, TFact>[] {
    const all = [...this.entries.values()];
    if (format === undefined) return all;
    return all.filter(
      (rule) => rule.formats === undefined || rule.formats.includes(format)
    );
  }
}
