/**
 * The `client-report` blueprint: two structural variants of the same archetype
 * instantiated from the playground template's definitions, judged by their
 * own profile without anyone naming it, rendered warning-clean while every
 * slot still carries its marker, and fillable through the fill map alone.
 * A theme swap changes the look and nothing the profile asks; a profile swap
 * changes what is asked and nothing the theme paints.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateDocument } from '@json-to-office/shared-docx';
import { QUALITY_CODES } from '@json-to-office/quality';
import {
  readBlockDefinitions,
  validateBlueprint,
} from '@json-to-office/shared';
import {
  DOCX_BLUEPRINTS,
  docxBlueprint,
  instantiateDocxBlueprint,
  valueAt,
  type BlueprintFillEntry,
} from '../index';
import { generateBufferWithWarnings } from '../../core/generator';
import { analyzeDocxQuality } from '../../quality/preflight';
import { EXAMPLE } from '../../blocks/__tests__/example';

vi.mock('../../utils/environment', () => ({
  isNodeEnvironment: vi.fn().mockReturnValue(true),
  isBrowserEnvironment: vi.fn().mockReturnValue(false),
}));
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAABytg0kAAAAFElEQVR42mNk+M9QzwAFjDAGACPuA/8fMSCgAAAAAElFTkSuQmCC';
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);
beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({
    ok: true,
    text: vi.fn().mockResolvedValue(PNG_B64),
  });
});

const THEMES = ['consulting', 'minimal', 'vermilion', 'devportal'];
const blueprint = docxBlueprint('client-report')!;
const definitions = readBlockDefinitions(EXAMPLE);
const VARIANTS = Object.keys(blueprint.variants);
const codes = (doc: unknown, options = {}) =>
  analyzeDocxQuality(doc, options).diagnostics.map((finding) => finding.code);

/** Plausible content for a marker: numbers stay numbers, text stays short. */
const content = (entry: BlueprintFillEntry): string => {
  if (/^\d/.test(entry.guidance)) return '4.2';
  if (entry.guidance === 'unit') return '%';
  if (entry.guidance.startsWith('Source'))
    return 'Source: operating review, 2026.';
  if (entry.guidance.startsWith('Month')) return 'September 2026';
  return entry.guidance.replace(/^[^:]*:\s*/, '').split(',')[0];
};
const set = (root: unknown, pointer: string, value: unknown): void => {
  const segments = pointer.split('/').slice(1);
  const parent = valueAt(root, `/${segments.slice(0, -1).join('/')}`) as
    | Record<string, unknown>
    | unknown[];
  const last = segments[segments.length - 1];
  if (Array.isArray(parent)) parent[Number(last)] = value;
  else parent[last] = value;
};

describe('the client-report blueprint', () => {
  it('is a registered, schema-valid plan with a data-heavy and a narrative variant', () => {
    expect(Object.keys(DOCX_BLUEPRINTS)).toContain('client-report');
    expect(validateBlueprint(blueprint)).toEqual([]);
    expect(VARIANTS).toEqual(['data-heavy', 'narrative']);
    expect(blueprint).toMatchObject({
      theme: 'consulting',
      profile: 'client-report',
      definitions: 'client-report-blocks.docx.json',
    });
  });

  describe.each(VARIANTS)('the %s variant', (variant) => {
    it('instantiates schema- and semantic-clean, carrying every definition it invokes and their dependencies', () => {
      const { document, fillMap } = instantiateDocxBlueprint(blueprint, {
        variant,
        definitions,
      });
      expect(validateDocument(document).errors).toEqual([]);
      const carried = Object.keys(
        (document.props as { blocks: Record<string, unknown> }).blocks
      );
      expect(carried).toEqual(
        expect.arrayContaining([
          'cover',
          'running-head',
          'section-opener',
          'key-takeaways',
          'footnotes',
          'source-line',
        ])
      );
      expect(carried).not.toContain('figure');
      expect(fillMap.length).toBeGreaterThan(20);
      for (const entry of fillMap) {
        expect(valueAt(document, entry.path), entry.path).toBe(entry.marker);
        expect(entry.guidance.length).toBeGreaterThan(0);
      }
      const title = fillMap.find(
        (entry) => entry.block === 'cover' && entry.slot === 'title'
      );
      expect(title).toMatchObject({
        kind: 'slot',
        type: 'string',
        maxWords: 16,
        oneLine: true,
        required: true,
      });
      expect(
        fillMap.find((entry) => entry.slot === 'items.label')
      ).toMatchObject({ block: 'kpi-row', kind: 'slot', maxWords: 6 });
      expect(
        fillMap.find((entry) => entry.path === '/props/metadata/title')
      ).toMatchObject({ kind: 'metadata' });
      expect(
        fillMap.filter((entry) => entry.kind === 'text').length
      ).toBeGreaterThan(0);
      const value = fillMap.find((entry) => entry.slot === 'items.value');
      expect(value).toMatchObject({ block: 'kpi-row', maxLength: 12 });
      if (variant === 'data-heavy') {
        // A marker inside the chart's own options reports the component slot.
        const inChart = fillMap.filter(
          (entry) => entry.block === 'chart-figure' && entry.slot === 'chart'
        );
        expect(inChart.length).toBeGreaterThanOrEqual(3);
        expect(inChart[0]).toMatchObject({ kind: 'slot', type: 'component' });
        expect(inChart[0].path).toContain('/props/slots/chart/props/options');
      }
    });

    it('is judged by its own profile without arguments, reports only draft markers, and renders warning-clean', async () => {
      const { document } = instantiateDocxBlueprint(blueprint, {
        variant,
        definitions,
      });
      const analysis = analyzeDocxQuality(document);
      expect(analysis.profileId).toBe('client-report');
      expect(analysis.blocked).toBe(false);
      expect(new Set(analysis.diagnostics.map((d) => d.code))).toEqual(
        new Set([QUALITY_CODES.SCAFFOLD_MARKER])
      );
      const { warnings } = await generateBufferWithWarnings(document);
      expect(warnings).toEqual([]);
    });

    it('is generation-ready once every fill-map pointer is patched', () => {
      const { document, fillMap } = instantiateDocxBlueprint(blueprint, {
        variant,
        definitions,
      });
      for (const entry of fillMap) set(document, entry.path, content(entry));
      expect(validateDocument(document).errors).toEqual([]);
      const findings = analyzeDocxQuality(document).diagnostics.filter(
        (finding) => finding.severity !== 'info'
      );
      expect(findings).toEqual([]);
    });

    it.each(THEMES)(
      'asks the same of the document on the %s theme, markers filled and one source blanked',
      (theme) => {
        const filled = (on: string | undefined) => {
          const { document, fillMap } = instantiateDocxBlueprint(blueprint, {
            variant,
            ...(on && { theme: on }),
            definitions,
          });
          for (const entry of fillMap)
            set(document, entry.path, content(entry));
          const source = fillMap.find(
            (entry) => entry.block === 'kpi-row' && entry.slot === 'source'
          )!;
          set(document, source.path, '');
          return document;
        };
        const document = filled(theme);
        expect((document.props as { theme: string }).theme).toBe(theme);
        expect(validateDocument(document).errors).toEqual([]);
        const found = codes(document);
        expect(found).toContain(QUALITY_CODES.CHROME_MISSING);
        expect(found).toEqual(codes(filled(undefined)));
      }
    );

    it('owes the chrome to the profile, not the theme', () => {
      const { document, fillMap } = instantiateDocxBlueprint(blueprint, {
        variant,
        definitions,
      });
      for (const entry of fillMap) set(document, entry.path, content(entry));
      const sourced = fillMap.find(
        (entry) => entry.block === 'kpi-row' && entry.slot === 'source'
      )!;
      set(document, sourced.path, '');
      const props = document.props as Record<string, unknown>;
      expect(codes(document)).toContain(QUALITY_CODES.CHROME_MISSING);
      const technical = codes(document, {
        profile: { id: 'technical-report', formats: ['docx'] },
      });
      expect(technical).not.toContain(QUALITY_CODES.CHROME_MISSING);
      expect(props.theme).toBe('consulting');
      expect(props.themeOverrides).toBeUndefined();
    });
  });

  it('refuses a variant it does not have and a definition the template lacks', () => {
    expect(() =>
      instantiateDocxBlueprint(blueprint, { variant: 'memo', definitions })
    ).toThrow(/no variant "memo"/);
    const { cover: _cover, ...without } = definitions; // eslint-disable-line @typescript-eslint/no-unused-vars
    expect(() =>
      instantiateDocxBlueprint(blueprint, { definitions: without })
    ).toThrow(/invokes "cover"/);
  });
});
