/**
 * The two server shapes for one finding drift apart easily: `/generate`
 * flattens everything into `context` and loses the 'error' severity, while
 * `/validate` keeps the fields top level. These tests pin both, plus the
 * defensiveness that keeps a malformed payload from blanking the panel.
 */
import { describe, it, expect } from 'vitest';
import {
  splitQualityWarnings,
  findingsFromAnalysis,
  countBySeverity,
  groupByCategory,
  compareFindings,
  filterByMinSeverity,
  certaintyLabel,
  type GenerationWarningLike,
  type QualityFinding,
} from '../quality-findings';

const qualityWarning = (
  message: string,
  context: Record<string, unknown>,
  severity: 'warning' | 'info' = 'warning'
): GenerationWarningLike => ({
  component: 'quality',
  message,
  severity,
  context,
});

const finding = (
  overrides: Partial<QualityFinding> & Pick<QualityFinding, 'severity'>
): QualityFinding => ({
  id: overrides.id ?? 'id',
  code: overrides.code ?? 'W_QUALITY_X',
  message: overrides.message ?? 'msg',
  path: overrides.path ?? '/children/0',
  ...overrides,
});

describe('splitQualityWarnings', () => {
  it('returns empty results for null, undefined and non-arrays', () => {
    expect(splitQualityWarnings(null)).toEqual({ findings: [], others: [] });
    expect(splitQualityWarnings(undefined)).toEqual({
      findings: [],
      others: [],
    });
    expect(
      splitQualityWarnings('nope' as unknown as GenerationWarningLike[])
    ).toEqual({ findings: [], others: [] });
    expect(splitQualityWarnings([])).toEqual({ findings: [], others: [] });
  });

  it('passes non-quality warnings through untouched and in order', () => {
    const font: GenerationWarningLike = {
      component: 'font',
      message: 'Substituted Inter',
    };
    const image: GenerationWarningLike = {
      component: 'image',
      message: 'Low resolution',
      severity: 'info',
      context: { dpi: 72 },
    };
    const { findings, others } = splitQualityWarnings([
      font,
      qualityWarning('[W_QUALITY_A] a', { code: 'W_QUALITY_A', path: '/a' }),
      image,
    ]);

    expect(findings).toHaveLength(1);
    expect(others).toEqual([font, image]);
    // Passthrough must not clone or rewrite the original objects.
    expect(others[0]).toBe(font);
    expect(others[1]).toBe(image);
  });

  it('strips the [CODE] prefix when it matches context.code', () => {
    const { findings } = splitQualityWarnings([
      qualityWarning('[W_QUALITY_FONT_SIZE_MIN] Body text is 5pt', {
        code: 'W_QUALITY_FONT_SIZE_MIN',
        path: '/children/2',
      }),
    ]);

    expect(findings[0].message).toBe('Body text is 5pt');
    expect(findings[0].code).toBe('W_QUALITY_FONT_SIZE_MIN');
  });

  it('leaves a bracketed prefix alone when it is not the code', () => {
    const { findings } = splitQualityWarnings([
      qualityWarning('[Section 3] Body text is 5pt', {
        code: 'W_QUALITY_FONT_SIZE_MIN',
        path: '/children/2',
      }),
    ]);

    expect(findings[0].message).toBe('[Section 3] Body text is 5pt');
  });

  it('does not strip a prefix when the code is missing', () => {
    const { findings } = splitQualityWarnings([
      qualityWarning('[W_QUALITY_FONT_SIZE_MIN] Body text is 5pt', {
        path: '/children/2',
      }),
    ]);

    expect(findings[0].message).toBe(
      '[W_QUALITY_FONT_SIZE_MIN] Body text is 5pt'
    );
    expect(findings[0].code).toBe('');
  });

  it('prefers context.originalSeverity over the coerced top-level severity', () => {
    const { findings } = splitQualityWarnings([
      qualityWarning(
        '[W_QUALITY_TEXT_OVERFLOW] Overflows',
        {
          code: 'W_QUALITY_TEXT_OVERFLOW',
          path: '/slides/0',
          originalSeverity: 'error',
        },
        // The server squashes 'error' down to 'warning' on this field.
        'warning'
      ),
    ]);

    expect(findings[0].severity).toBe('error');
  });

  it('falls back to the top-level severity, then to warning', () => {
    const { findings } = splitQualityWarnings([
      qualityWarning('[A] a', { code: 'A', path: '/a' }, 'info'),
      // An illegal originalSeverity must not win over the usable field.
      qualityWarning(
        '[B] b',
        { code: 'B', path: '/b', originalSeverity: 'critical' },
        'info'
      ),
      { component: 'quality', message: '[C] c', context: { code: 'C' } },
    ]);

    expect(findings.map((f) => f.severity)).toEqual([
      'info',
      'info',
      'warning',
    ]);
  });

  it('carries the full envelope across', () => {
    const { findings } = splitQualityWarnings([
      qualityWarning('[W_QUALITY_HEADING_SKIP] Heading level jumps 1 -> 3', {
        code: 'W_QUALITY_HEADING_SKIP',
        path: '/children/4',
        originalSeverity: 'warning',
        ruleId: 'docx/heading-skip',
        category: 'hierarchy',
        certainty: 'deterministic',
        blocking: false,
        suggestion: 'Insert a level 2 heading.',
        relatedPaths: ['/children/2'],
        evidence: { actual: 3, expected: 2, unit: 'level' },
        fixes: [{ op: 'replace', path: '/children/4/props/level', value: 2 }],
      }),
    ]);

    expect(findings[0]).toMatchObject({
      code: 'W_QUALITY_HEADING_SKIP',
      message: 'Heading level jumps 1 -> 3',
      path: '/children/4',
      severity: 'warning',
      ruleId: 'docx/heading-skip',
      category: 'hierarchy',
      certainty: 'deterministic',
      blocking: false,
      suggestion: 'Insert a level 2 heading.',
      relatedPaths: ['/children/2'],
      evidence: { actual: 3, expected: 2, unit: 'level' },
      fixes: [{ op: 'replace', path: '/children/4/props/level', value: 2 }],
    });
  });

  it('survives a missing or malformed context', () => {
    const { findings } = splitQualityWarnings([
      { component: 'quality', message: 'No context at all' },
      qualityWarning('Wrong types everywhere', {
        code: 42,
        path: { nested: true },
        ruleId: ['a'],
        category: 7,
        certainty: 'vibes',
        blocking: 'yes',
        suggestion: null,
        relatedPaths: 'not-an-array',
        evidence: 'not-an-object',
        fixes: 'not-an-array',
      }),
      {
        component: 'quality',
        message: 'Array context',
        context: ['a'] as unknown as Record<string, unknown>,
      },
    ]);

    expect(findings).toHaveLength(3);
    for (const f of findings) {
      expect(f.code).toBe('');
      expect(f.path).toBe('');
      expect(f.ruleId).toBeUndefined();
      expect(f.category).toBeUndefined();
      expect(f.certainty).toBeUndefined();
      expect(f.blocking).toBeUndefined();
      expect(f.suggestion).toBeUndefined();
      expect(f.relatedPaths).toBeUndefined();
      expect(f.evidence).toBeUndefined();
      expect(f.fixes).toBeUndefined();
    }
  });

  it('drops entries that have neither a code nor a message', () => {
    const { findings, others } = splitQualityWarnings([
      { component: 'quality', message: '', context: { path: '/a' } },
      qualityWarning('kept', { path: '/b' }),
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0].message).toBe('kept');
    expect(others).toEqual([]);
  });

  it('shows the code when the message is empty', () => {
    const { findings } = splitQualityWarnings([
      { component: 'quality', message: '', context: { code: 'W_QUALITY_A' } },
    ]);

    expect(findings[0].message).toBe('W_QUALITY_A');
  });

  it('keeps only well-formed patch operations', () => {
    const { findings } = splitQualityWarnings([
      qualityWarning('[A] a', {
        code: 'A',
        path: '/a',
        fixes: [
          { op: 'replace', path: '/a/props/size', value: 10 },
          { op: 'move', path: '/b', from: '/c' },
          // No legal op, no string path, not an object.
          { op: 'transmogrify', path: '/a' },
          { op: 'add', path: 12 },
          'nonsense',
        ],
      }),
    ]);

    expect(findings[0].fixes).toEqual([
      { op: 'replace', path: '/a/props/size', value: 10 },
      { op: 'move', path: '/b', from: '/c' },
    ]);
  });

  it('gives every finding a distinct id, stable across calls', () => {
    const warnings = [
      qualityWarning('[A] first', { code: 'A', path: '/a' }),
      qualityWarning('[A] second', { code: 'A', path: '/a' }),
    ];
    const first = splitQualityWarnings(warnings).findings;
    const second = splitQualityWarnings(warnings).findings;

    expect(first[0].id).not.toBe(first[1].id);
    expect(first.map((f) => f.id)).toEqual(second.map((f) => f.id));
  });

  it('never throws on hostile input', () => {
    expect(() =>
      splitQualityWarnings([
        null,
        undefined,
        42,
        'quality',
      ] as unknown as GenerationWarningLike[])
    ).not.toThrow();
  });
});

describe('findingsFromAnalysis', () => {
  const analysis = {
    diagnostics: [
      {
        source: 'quality',
        code: 'W_QUALITY_TEXT_OVERFLOW',
        severity: 'error',
        message: 'Body text overflows the placeholder by 42pt',
        path: '/slides/1/components/2',
        ruleId: 'pptx/text-overflow',
        category: 'composition',
        certainty: 'measured',
        blocking: true,
        suggestion: 'Shorten the text or enlarge the box.',
        relatedPaths: ['/slides/1'],
        evidence: { actual: 242, expected: 200, unit: 'pt' },
        fixes: [
          { op: 'replace', path: '/slides/1/components/2/props/h', value: 3.2 },
        ],
      },
      {
        source: 'quality',
        code: 'W_QUALITY_FONT_SIZE_MIN',
        severity: 'warning',
        message: 'Body text is 5pt',
        path: '/slides/0/components/1',
        ruleId: 'pptx/font-size-min',
        category: 'legibility',
        certainty: 'deterministic',
        blocking: false,
      },
    ],
    counts: { error: 1, warning: 1, info: 0 },
    blocked: true,
    truncated: false,
    suppressedCount: 0,
    evaluatedRuleIds: ['pptx/text-overflow', 'pptx/font-size-min'],
    ruleErrors: [],
    profileId: 'executive-presentation',
  };

  it('reads the top-level fields of a realistic qualityAnalysis', () => {
    const findings = findingsFromAnalysis(analysis);

    expect(findings).toHaveLength(2);
    expect(findings[0]).toMatchObject({
      code: 'W_QUALITY_TEXT_OVERFLOW',
      // No [CODE] prefix on this path, so the message is untouched.
      message: 'Body text overflows the placeholder by 42pt',
      path: '/slides/1/components/2',
      severity: 'error',
      ruleId: 'pptx/text-overflow',
      category: 'composition',
      certainty: 'measured',
      blocking: true,
      suggestion: 'Shorten the text or enlarge the box.',
      relatedPaths: ['/slides/1'],
      evidence: { actual: 242, expected: 200, unit: 'pt' },
    });
    expect(findings[1].severity).toBe('warning');
    expect(findings[0].id).not.toBe(findings[1].id);
  });

  it('returns [] for anything that is not an analysis with diagnostics', () => {
    expect(findingsFromAnalysis(null)).toEqual([]);
    expect(findingsFromAnalysis(undefined)).toEqual([]);
    expect(findingsFromAnalysis(42)).toEqual([]);
    expect(findingsFromAnalysis('quality')).toEqual([]);
    expect(findingsFromAnalysis([])).toEqual([]);
    expect(findingsFromAnalysis({})).toEqual([]);
    expect(findingsFromAnalysis({ diagnostics: null })).toEqual([]);
    expect(findingsFromAnalysis({ diagnostics: {} })).toEqual([]);
  });

  it('defaults an illegal severity to warning and skips junk entries', () => {
    const findings = findingsFromAnalysis({
      diagnostics: [
        { code: 'A', message: 'a', path: '/a', severity: 'critical' },
        null,
        'nope',
        { path: '/b' },
      ],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
  });

  it('also strips a doubled [CODE] prefix if one appears', () => {
    const findings = findingsFromAnalysis({
      diagnostics: [
        { code: 'W_QUALITY_A', message: '[W_QUALITY_A] a', path: '/a' },
      ],
    });

    expect(findings[0].message).toBe('a');
  });
});

describe('countBySeverity', () => {
  it('counts each severity and ignores unknown ones', () => {
    expect(
      countBySeverity([
        finding({ severity: 'error' }),
        finding({ severity: 'error' }),
        finding({ severity: 'warning' }),
        finding({ severity: 'info' }),
        finding({ severity: 'critical' as never }),
      ])
    ).toEqual({ error: 2, warning: 1, info: 1 });
  });

  it('returns zeroes for empty input', () => {
    expect(countBySeverity([])).toEqual({ error: 0, warning: 0, info: 0 });
  });
});

describe('compareFindings', () => {
  it('orders error before warning before info', () => {
    const sorted = [
      finding({ severity: 'info', path: '/a', code: 'A' }),
      finding({ severity: 'error', path: '/z', code: 'Z' }),
      finding({ severity: 'warning', path: '/m', code: 'M' }),
    ].sort(compareFindings);

    expect(sorted.map((f) => f.severity)).toEqual(['error', 'warning', 'info']);
  });

  it('breaks ties by path, then by code', () => {
    const sorted = [
      finding({ severity: 'warning', path: '/b', code: 'A' }),
      finding({ severity: 'warning', path: '/a', code: 'Z' }),
      finding({ severity: 'warning', path: '/a', code: 'B' }),
    ].sort(compareFindings);

    expect(sorted.map((f) => `${f.path}:${f.code}`)).toEqual([
      '/a:B',
      '/a:Z',
      '/b:A',
    ]);
  });

  it('reports identical findings as equal', () => {
    const a = finding({ severity: 'warning', path: '/a', code: 'A' });
    const b = finding({ severity: 'warning', path: '/a', code: 'A' });
    expect(compareFindings(a, b)).toBe(0);
  });
});

describe('groupByCategory', () => {
  it('sorts groups by worst severity, then by category name', () => {
    const groups = groupByCategory([
      finding({ severity: 'info', category: 'brand', path: '/b' }),
      finding({ severity: 'warning', category: 'legibility', path: '/l' }),
      finding({ severity: 'error', category: 'composition', path: '/c' }),
      // Same worst severity as legibility, so the name decides.
      finding({ severity: 'warning', category: 'accessibility', path: '/a' }),
    ]);

    expect(groups.map((g) => g.category)).toEqual([
      'composition',
      'accessibility',
      'legibility',
      'brand',
    ]);
  });

  it("buckets findings with no category under 'other'", () => {
    const groups = groupByCategory([
      finding({ severity: 'warning', path: '/a' }),
      finding({ severity: 'warning', category: '', path: '/b' }),
      finding({ severity: 'warning', category: 'brand', path: '/c' }),
    ]);

    const other = groups.find((g) => g.category === 'other');
    expect(other?.findings).toHaveLength(2);
  });

  it('sorts findings inside a group', () => {
    const groups = groupByCategory([
      finding({ severity: 'info', category: 'brand', path: '/b', code: 'B' }),
      finding({ severity: 'error', category: 'brand', path: '/a', code: 'A' }),
    ]);

    expect(groups[0].findings.map((f) => f.code)).toEqual(['A', 'B']);
  });

  it('returns [] for empty input', () => {
    expect(groupByCategory([])).toEqual([]);
  });
});

describe('filterByMinSeverity', () => {
  const all = [
    finding({ severity: 'error', path: '/e' }),
    finding({ severity: 'warning', path: '/w' }),
    finding({ severity: 'info', path: '/i' }),
  ];

  it('keeps only findings at or above the threshold', () => {
    expect(filterByMinSeverity(all, 'error').map((f) => f.severity)).toEqual([
      'error',
    ]);
    expect(filterByMinSeverity(all, 'warning').map((f) => f.severity)).toEqual([
      'error',
      'warning',
    ]);
    expect(filterByMinSeverity(all, 'info')).toHaveLength(3);
  });

  it('preserves the input order', () => {
    const shuffled = [all[2], all[0], all[1]];
    expect(filterByMinSeverity(shuffled, 'info').map((f) => f.path)).toEqual([
      '/i',
      '/e',
      '/w',
    ]);
  });

  it('lets everything through for an unrecognised threshold', () => {
    expect(filterByMinSeverity(all, 'critical' as never)).toHaveLength(3);
  });

  it('returns [] for empty input', () => {
    expect(filterByMinSeverity([], 'info')).toEqual([]);
  });
});

describe('certaintyLabel', () => {
  it.each([
    ['deterministic', 'Deterministic'],
    ['measured', 'Measured'],
    ['estimated', 'Estimated'],
    ['rendered', 'Rendered'],
    ['evaluative', 'Evaluative'],
  ] as const)('%s -> %s', (input, expected) => {
    expect(certaintyLabel(input)).toBe(expected);
  });

  it('returns undefined for a missing or unknown certainty', () => {
    expect(certaintyLabel(undefined)).toBeUndefined();
    expect(certaintyLabel('guessed' as never)).toBeUndefined();
  });
});
