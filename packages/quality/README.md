# @json-to-office/quality

Format-agnostic contracts and orchestration for document design quality. No
DOCX/PPTX core, renderer, filesystem, or UI dependency.

```bash
pnpm add @json-to-office/quality
```

## Model

- facts describe resolved document evidence;
- pure rules turn facts into diagnostics;
- profiles define “good” for a document class;
- policies decide overrides, suppressions, budgets, and CI gating;
- certainty (`deterministic`, `measured`, `estimated`, `rendered`,
  `evaluative`) stays independent from severity.

```ts
import { QualityEngine, type QualityRule } from '@json-to-office/quality';

const rule: QualityRule = {
  id: 'acme/required-title',
  code: 'W_ACME_REQUIRED_TITLE',
  category: 'hierarchy',
  defaultSeverity: 'warning',
  defaultCertainty: 'deterministic',
  evaluate: ({ facts }) =>
    facts.some((fact) => fact.kind === 'acme/title')
      ? []
      : [{ path: '', message: 'Document has no title.' }],
};

const analysis = await new QualityEngine([rule]).analyze(prepared, {
  profile: { id: 'executive-report', formats: ['docx'] },
  policy: { gate: 'warning' },
});

if (analysis.blocked) {
  // Return analysis.diagnostics or fail CI.
}
```

Format preparation, built-in facts, rules, and profiles live in
`@json-to-office/core-docx` and `@json-to-office/core-pptx`. See
[`docs/architecture/taste-system.md`](../../docs/architecture/taste-system.md)
for the quality reference and package boundaries.
