/**
 * The `consulting-deck` blueprint: two structural variants of the same
 * archetype instantiated from the deck template's definitions, judged by the
 * `consulting-deck` profile without anyone naming it, rendered warning-clean
 * while every slot still carries its marker, and fillable through the fill
 * map alone. A deck's metadata sits under `props`, not `props.metadata`. A
 * theme swap changes the look and nothing the profile asks; a profile swap
 * changes what is asked and nothing the theme paints.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validatePresentationDocument } from '@json-to-office/shared-pptx';
import { QUALITY_CODES } from '@json-to-office/quality';
import {
  readBlockDefinitions,
  validateBlueprint,
  valueAt,
  type BlueprintFillEntry,
} from '@json-to-office/shared';
import {
  PPTX_BLUEPRINTS,
  instantiatePptxBlueprint,
  pptxBlueprint,
} from '../index';
import { generateBufferWithWarnings } from '../../core/generator';
import { analyzePptxQuality } from '../../quality/preflight';
import { pptxThemes } from '../../themes';

const TEMPLATE = JSON.parse(
  readFileSync(
    new URL(
      '../../../../jto/src/client/public/templates/consulting-deck-blocks.pptx.json',
      import.meta.url
    ),
    'utf8'
  )
);
const blueprint = pptxBlueprint('consulting-deck')!;
const definitions = readBlockDefinitions(TEMPLATE);
const VARIANTS = Object.keys(blueprint.variants);
const THEMES = Object.keys(pptxThemes);
const codes = (doc: unknown, options = {}) =>
  analyzePptxQuality(doc, options).diagnostics.map((finding) => finding.code);

/** Plausible content for a marker: numbers stay numbers, text stays short. */
const content = (entry: BlueprintFillEntry): string => {
  if (/^[+\d]/.test(entry.guidance)) return '4.2';
  if (entry.guidance === 'unit') return '%';
  if (entry.guidance.startsWith('Source'))
    return 'Source: operating review, 2026.';
  if (entry.guidance.startsWith('Month')) return 'September 2026';
  if (entry.guidance.startsWith('Tracker')) return 'Summary';
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
const filled = (variant: string, theme?: string) => {
  const { document, fillMap } = instantiatePptxBlueprint(blueprint, {
    variant,
    ...(theme && { theme }),
    definitions,
  });
  for (const entry of fillMap) set(document, entry.path, content(entry));
  return { document, fillMap };
};

describe('the consulting-deck blueprint', () => {
  it('is a registered, schema-valid plan with a data-heavy and a narrative variant', () => {
    expect(Object.keys(PPTX_BLUEPRINTS)).toEqual(['consulting-deck']);
    expect(validateBlueprint(blueprint)).toEqual([]);
    expect(VARIANTS).toEqual(['data-heavy', 'narrative']);
    expect(blueprint).toMatchObject({
      format: 'pptx',
      theme: 'consulting',
      profile: 'consulting-deck',
      definitions: 'consulting-deck-blocks.pptx.json',
      numbering: 'none',
      toc: false,
    });
  });

  describe.each(VARIANTS)('the %s variant', (variant) => {
    it('instantiates a valid deck on the wide canvas, metadata under props, carrying every definition it invokes', () => {
      const { document, fillMap } = instantiatePptxBlueprint(blueprint, {
        variant,
        definitions,
      });
      expect(validatePresentationDocument(document).errors).toEqual([]);
      const props = document.props as Record<string, unknown>;
      expect(props).toMatchObject({
        theme: 'consulting',
        qualityProfile: 'consulting-deck',
        slideWidth: 13.333,
        slideHeight: 7.5,
        title: '{{Title: as on the cover}}',
      });
      expect(props.metadata).toBeUndefined();
      expect(Object.keys(props.blocks as object)).toEqual(
        expect.arrayContaining([
          'cover',
          'action-chart',
          'two-column',
          'statement',
        ])
      );
      expect((document.children as unknown[]).length).toBe(7);
      for (const entry of fillMap)
        expect(valueAt(document, entry.path), entry.path).toBe(entry.marker);
      expect(
        fillMap.find((entry) => entry.path === '/props/title')
      ).toMatchObject({ kind: 'metadata' });
      expect(
        fillMap.filter((entry) => entry.kind === 'metadata').map((e) => e.path)
      ).toEqual(['/props/title', '/props/author', '/props/company']);
      const title = fillMap.find(
        (entry) => entry.block === 'cover' && entry.slot === 'title'
      );
      expect(title).toMatchObject({
        kind: 'slot',
        maxWords: 16,
        required: true,
      });
      // A marker inside the chart's own data reports the component slot.
      const inChart = fillMap.filter(
        (entry) => entry.block === 'action-chart' && entry.slot === 'chart'
      );
      expect(inChart.length).toBeGreaterThanOrEqual(4);
      expect(inChart[0]).toMatchObject({ kind: 'slot', type: 'component' });
      // A deck has no ordinary text markers: every marker is a slot or metadata.
      expect(fillMap.filter((entry) => entry.kind === 'text')).toEqual([]);
    });

    it('is judged by its own profile without arguments, reports only draft markers, and renders warning-clean', async () => {
      const { document } = instantiatePptxBlueprint(blueprint, {
        variant,
        definitions,
      });
      const analysis = analyzePptxQuality(document);
      expect(analysis.profileId).toBe('consulting-deck');
      expect(analysis.blocked).toBe(false);
      // The markers are advisory; the only other thing the deck reports is
      // the info-level tight box every action title carries on the template.
      expect(
        new Set(
          analysis.diagnostics
            .filter(
              (d) => d.severity !== 'info' || d.code !== 'W_QUALITY_TEXT_TIGHT'
            )
            .map((d) => d.code)
        )
      ).toEqual(new Set([QUALITY_CODES.SCAFFOLD_MARKER]));
      const { warnings } = await generateBufferWithWarnings(document as never);
      expect(warnings).toEqual([]);
    });

    it('is generation-ready once every fill-map pointer is patched', async () => {
      const { document } = filled(variant);
      expect(validatePresentationDocument(document).errors).toEqual([]);
      expect(
        analyzePptxQuality(document)
          .diagnostics.filter((finding) => finding.severity !== 'info')
          .map((f) => `${f.code} ${f.path}`)
      ).toEqual([]);
      const { warnings } = await generateBufferWithWarnings(document as never);
      expect(warnings).toEqual([]);
    });

    it.each(THEMES)(
      'asks the same of the deck on the %s theme, markers filled and one source blanked',
      async (theme) => {
        const blanked = (on: string | undefined) => {
          const { document, fillMap } = filled(variant, on);
          const source = fillMap.find(
            (entry) => entry.block === 'action-chart' && entry.slot === 'source'
          )!;
          set(document, source.path, '');
          return document;
        };
        const document = blanked(theme);
        expect((document.props as { theme: string }).theme).toBe(theme);
        expect(validatePresentationDocument(document).errors).toEqual([]);
        const found = codes(document);
        expect(found).toContain(QUALITY_CODES.CHROME_MISSING);
        expect(found).toEqual(codes(blanked(undefined)));
        const { warnings } = await generateBufferWithWarnings(
          document as never
        );
        expect(warnings).toEqual([]);
      }
    );

    it('owes the takeaway and the source to the profile, not the theme', () => {
      const { document, fillMap } = filled(variant);
      const takeaway = fillMap.find(
        (entry) => entry.block === 'action-chart' && entry.slot === 'takeaway'
      )!;
      set(document, takeaway.path, '');
      expect(codes(document)).toContain(QUALITY_CODES.CHROME_MISSING);
      expect(
        codes(document, {
          profile: { id: 'technical-presentation', formats: ['pptx'] },
        })
      ).not.toContain(QUALITY_CODES.CHROME_MISSING);
    });
  });

  it('refuses a blueprint of another format, a variant it lacks and a definition the template lacks', () => {
    expect(() =>
      instantiatePptxBlueprint(
        { ...blueprint, format: 'docx' },
        { definitions }
      )
    ).toThrow(/is a docx blueprint/);
    expect(() =>
      instantiatePptxBlueprint(blueprint, { variant: 'memo', definitions })
    ).toThrow(/no variant "memo"/);
    const { cover: _cover, ...without } = definitions; // eslint-disable-line @typescript-eslint/no-unused-vars
    expect(() =>
      instantiatePptxBlueprint(blueprint, { definitions: without })
    ).toThrow(/invokes "cover"/);
  });
});
