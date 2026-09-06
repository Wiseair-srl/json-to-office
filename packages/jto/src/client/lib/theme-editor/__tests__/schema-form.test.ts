import { describe, expect, it } from 'vitest';
import { ThemeConfigSchema as DocxThemeConfigSchema } from '@json-to-office/shared-docx';
import { ThemeConfigSchema as PptxThemeConfigSchema } from '@json-to-office/shared-pptx';
import consultingPptx from '../../../../../../core-pptx/src/themes/consulting.pptx.theme.json';
import {
  extendedSections,
  fieldValueError,
  filterFields,
  humanize,
  matchesQuery,
  resolveThemeColor,
  schemaField,
  schemaTopLevelKeys,
  type SchemaField,
} from '../schema-form';

const pptx = JSON.parse(JSON.stringify(PptxThemeConfigSchema));
const docx = JSON.parse(JSON.stringify(DocxThemeConfigSchema));
const PPTX_FORM_KEYS = [
  'name',
  'displayName',
  'description',
  'version',
  'colors',
  'fonts',
  'defaults',
  'styles',
];
const DOCX_FORM_KEYS = [
  ...PPTX_FORM_KEYS.filter((k) => k !== 'defaults'),
  'page',
];

function find(fields: readonly SchemaField[], ...keys: string[]): SchemaField {
  let current: readonly SchemaField[] = fields;
  let found: SchemaField | undefined;
  for (const key of keys) {
    found = current.find((f) => f.key === key);
    if (!found) throw new Error(`no field ${keys.join('.')} (at ${key})`);
    current = found.children ?? [];
  }
  return found!;
}

describe('schema-driven theme fields', () => {
  it('derives one section per extended object key, in schema order, for both formats', () => {
    const sections = extendedSections(pptx, PPTX_FORM_KEYS);
    expect(sections.map((s) => s.key)).toEqual([
      'palette',
      'typography',
      'spacing',
      'chrome',
      'motif',
      'componentDefaults',
    ]);
    expect(sections.find((s) => s.key === 'chrome')!.hint).toContain('recipes');
    expect(sections.find((s) => s.key === 'motif')!.title).toBe('Motif');
    // Not "Typography": that is the fonts section's name.
    expect(sections.find((s) => s.key === 'typography')!.title).toBe(
      'Type roles & scale'
    );
    // DOCX declares arrays at the top level too; those are not sections.
    const docxSections = extendedSections(docx, DOCX_FORM_KEYS).map(
      (s) => s.key
    );
    expect(docxSections).toEqual([
      'palette',
      'typography',
      'spacing',
      'chrome',
      'motif',
      'componentDefaults',
    ]);
    expect(schemaTopLevelKeys(docx)).toContain('fontRegistry');
    expect(schemaTopLevelKeys(docx)).not.toContain('$schema');
  });

  it('classifies colours, enums, numbers with bounds, lists and groups from the schema', () => {
    const sections = extendedSections(pptx, PPTX_FORM_KEYS);
    const palette = sections.find((s) => s.key === 'palette')!.fields;
    expect(find(palette, 'rule')).toMatchObject({
      kind: 'color',
      path: ['palette', 'rule'],
      label: 'Rule',
    });
    expect(find(palette, 'rule').hint).toContain('theme color/palette token');
    const chart = find(palette, 'chart');
    expect(chart.kind).toBe('list');
    expect(chart.item?.kind).toBe('color');
    expect(chart.max).toBe(12);

    const typography = sections.find((s) => s.key === 'typography')!.fields;
    const face = find(typography, 'roles', 'eyebrow', 'face');
    expect(face.kind).toBe('enum');
    expect(face.options).toEqual(['heading', 'body', 'mono', 'light']);
    expect(find(typography, 'roles', 'eyebrow', 'weight')).toMatchObject({
      kind: 'number',
      min: 100,
      max: 900,
      integer: true,
    });
    expect(find(typography, 'roles', 'eyebrow', 'tracking').hint).toContain(
      'hundredths of an em'
    );

    const spacing = sections.find((s) => s.key === 'spacing')!.fields;
    // exclusiveMinimum 0 becomes a floor one step up.
    expect(find(spacing, 'basePt')).toMatchObject({ kind: 'number', min: 0.5 });
    expect(find(spacing, 'canvas', 'a4').label).toBe('A4');
    expect(find(spacing, 'canvas', 'a4', 'columns')).toMatchObject({
      kind: 'number',
      integer: true,
      min: 1,
      max: 100,
    });

    const motif = sections.find((s) => s.key === 'motif')!.fields;
    expect(find(motif, 'kind').options).toEqual([
      'none',
      'rule',
      'corner',
      'band',
    ]);
    expect(find(motif, 'color').kind).toBe('color');

    const chrome = sections.find((s) => s.key === 'chrome')!.fields;
    expect(find(chrome, 'keyTakeaways').kind).toBe('group');
    expect(find(chrome, 'keyTakeaways', 'rule', 'weightPt').kind).toBe(
      'number'
    );
    expect(find(chrome, 'keyTakeaways').label).toBe('Key takeaways');
  });

  it('hands what no single control fits to the JSON view', () => {
    const defaults = extendedSections(pptx, PPTX_FORM_KEYS).find(
      (s) => s.key === 'componentDefaults'
    )!.fields;
    // Text runs are an array of objects.
    expect(find(defaults, 'text', 'runs').kind).toBe('json');
    expect(find(defaults, 'text', 'fontSize').kind).toBe('number');
    // A DOCX page size is a name or an object.
    const page = schemaField('page', docx.properties.page, ['page']);
    expect(find(page.children!, 'size').kind).toBe('json');
    expect(schemaField('x', { additionalProperties: true }, ['x']).kind).toBe(
      'json'
    );
  });

  it('humanizes keys the way the rail labels things', () => {
    expect(humanize('basePt')).toBe('Base pt');
    expect(humanize('runningHead')).toBe('Running head');
    expect(humanize('safeAreaIn')).toBe('Safe area in');
    expect(humanize('a4')).toBe('A4');
    expect(humanize('wide169')).toBe('Wide169');
    expect(humanize('table_cell')).toBe('Table cell');
  });

  it('filters fields by key, label, hint and path, pruning groups', () => {
    const sections = extendedSections(pptx, PPTX_FORM_KEYS);
    const chrome = sections.find((s) => s.key === 'chrome')!.fields;
    const rule = filterFields(chrome, 'weight');
    expect(rule.map((f) => f.key)).toEqual(
      expect.arrayContaining(['runningHead', 'keyTakeaways', 'cover'])
    );
    expect(find(rule, 'keyTakeaways').children!.map((f) => f.key)).toEqual([
      'rule',
    ]);
    expect(
      find(rule, 'keyTakeaways', 'rule').children!.map((f) => f.key)
    ).toEqual(['weightPt']);
    // A group whose own name matches is kept whole.
    expect(
      find(filterFields(chrome, 'takeaways'), 'keyTakeaways').children
    ).toHaveLength(find(chrome, 'keyTakeaways').children!.length);
    expect(filterFields(chrome, 'zzz')).toEqual([]);
    expect(filterFields(chrome, '  ')).toHaveLength(chrome.length);
    expect(matchesQuery('Take', 'keyTakeaways')).toBe(true);
    expect(matchesQuery('', undefined)).toBe(true);
    expect(matchesQuery('x', undefined)).toBe(false);
  });

  it('reads the consulting theme through the form without a mismatch', () => {
    const theme = consultingPptx as Record<string, unknown>;
    const check = (fields: readonly SchemaField[], value: unknown): void => {
      for (const field of fields) {
        const own = (value as Record<string, unknown> | undefined)?.[field.key];
        expect(fieldValueError(field, own), field.path.join('.')).toBeNull();
        if (field.kind === 'group' && own !== undefined)
          check(field.children!, own);
      }
    };
    for (const section of extendedSections(pptx, PPTX_FORM_KEYS))
      check(section.fields, theme[section.key]);
    expect(
      fieldValueError(
        { kind: 'number', key: 'x', path: ['x'], label: 'X' },
        'a'
      )
    ).toBe('Not a number');
    expect(
      fieldValueError({ kind: 'group', key: 'x', path: ['x'], label: 'X' }, [])
    ).toBe('Not an object');
  });

  it('resolves colours through theme tokens and one palette hop', () => {
    const theme = consultingPptx as Record<string, unknown>;
    expect(resolveThemeColor(theme, '#1B4F8A')).toBe('#1B4F8A');
    expect(resolveThemeColor(theme, 'accent')).toBe('#1B4F8A');
    // chrome.keyTakeaways.rule.color is "accent"; chrome.runningHead.rule.color is "rule" (palette → hex).
    expect(resolveThemeColor(theme, 'rule')).toBe('#C9CED6');
    expect(resolveThemeColor({ palette: { a: 'a' } }, 'a')).toBeNull();
    expect(resolveThemeColor(theme, 'nowhere')).toBeNull();
  });
});
