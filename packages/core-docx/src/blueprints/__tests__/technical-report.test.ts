/**
 * The `technical-report` blueprint: three structural variants of the same
 * archetype — a data-heavy report, a narrative one and a memo — instantiated
 * from the technical-report template's definitions, judged by their own
 * profile without anyone naming it, rendered warning-clean while every slot
 * still carries its marker, and fillable through the fill map alone. The
 * profile asks for a source under every figure and a running head after the
 * cover; the memo declares its running head in its only section and gets it
 * on the first page. A theme swap changes the look and nothing the profile
 * asks; a profile swap changes what is asked and nothing the theme paints.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import AdmZip from 'adm-zip';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
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
import {
  findLibreOffice,
  hasPdftotext,
  requireIfInsisted,
} from '../../__tests__/libreoffice';

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

const run = promisify(execFile);
const THEMES = ['consulting', 'minimal', 'vermilion', 'devportal'];
const TEMPLATE = JSON.parse(
  readFileSync(
    new URL(
      '../../../../jto/src/client/public/templates/technical-report-blocks.docx.json',
      import.meta.url
    ),
    'utf8'
  )
);
const blueprint = docxBlueprint('technical-report')!;
const definitions = readBlockDefinitions(TEMPLATE);
const VARIANTS = Object.keys(blueprint.variants);
const codes = (doc: unknown, options = {}) =>
  analyzeDocxQuality(doc, options).diagnostics.map((finding) => finding.code);

/** Plausible content for a marker: numbers stay numbers, text stays short. */
const content = (entry: BlueprintFillEntry): string => {
  if (/^\d/.test(entry.guidance)) return '4.2';
  if (entry.guidance.startsWith('Source'))
    return 'Source: load test runs 7 to 10, staging, 2026.';
  if (entry.guidance.startsWith('Month')) return 'September 2026';
  if (entry.guidance.startsWith('D Month')) return '9 September 2026';
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
  const { document, fillMap } = instantiateDocxBlueprint(blueprint, {
    variant,
    ...(theme && { theme }),
    definitions,
  });
  for (const entry of fillMap) set(document, entry.path, content(entry));
  return { document, fillMap };
};
const invocations = (document: unknown): string[] => {
  const refs: string[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    const props = record.props as Record<string, unknown> | undefined;
    if (record.name === 'block' && typeof props?.ref === 'string')
      refs.push(props.ref);
    Object.values(record).forEach(visit);
  };
  visit((document as { children: unknown[] }).children);
  return refs;
};

/** Header and footer text and the break type of each section, in order. */
const chrome = (buffer: Buffer) => {
  const zip = new AdmZip(buffer);
  const main = zip.readAsText('word/document.xml');
  const rels = zip.readAsText('word/_rels/document.xml.rels');
  const text = (xml: string) =>
    xml
      .replace(/<w:tab\/>/g, '\t')
      .replace(/<[^>]+>/g, '')
      .trim();
  const target = (id: string) =>
    rels.match(new RegExp(`Id="${id}"[^>]*Target="([^"]+)"`))?.[1] ??
    rels.match(new RegExp(`Target="([^"]+)"[^>]*Id="${id}"`))?.[1];
  const part = (kind: 'header' | 'footer', sectPr: string) => {
    const id = sectPr.match(
      new RegExp(`<w:${kind}Reference[^>]*w:type="default"[^>]*r:id="([^"]+)"`)
    )?.[1];
    return id ? text(zip.readAsText(`word/${target(id)}`)) : undefined;
  };
  return [...main.matchAll(/<w:sectPr[\s>][\s\S]*?<\/w:sectPr>/g)].map(
    ([sectPr]) => ({
      type: sectPr.match(/<w:type w:val="([^"]+)"/)?.[1],
      header: part('header', sectPr),
      footer: part('footer', sectPr),
    })
  );
};

const CLIENT_TEMPLATE = JSON.parse(
  readFileSync(
    new URL(
      '../../../../jto/src/client/public/templates/client-report-blocks.docx.json',
      import.meta.url
    ),
    'utf8'
  )
);

describe('the technical-report blueprint', () => {
  // The two report templates carry their own copies of the architecture
  // blocks, so a change to one is a change that has to be made twice. This
  // is the guard that says so: edit it only to record a definition the two
  // archetypes deliberately differ on, never to let a drift pass.
  it('keeps every block it shares with the client report identical to it', () => {
    const client = readBlockDefinitions(CLIENT_TEMPLATE);
    const shared = Object.keys(definitions).filter((ref) => ref in client);
    expect(shared.sort()).toEqual([
      'callout',
      'chart-figure',
      'cover',
      'data-table',
      'figure-caption',
      'footnotes',
      'key-takeaways',
      'running-head',
      'section-opener',
      'source-line',
    ]);
    for (const ref of shared)
      expect(definitions[ref], ref).toEqual(client[ref]);
  });

  it('is a registered, schema-valid plan with a data-heavy, a narrative and a memo variant', () => {
    expect(Object.keys(DOCX_BLUEPRINTS)).toEqual([
      'client-report',
      'technical-report',
    ]);
    expect(validateBlueprint(blueprint)).toEqual([]);
    expect(VARIANTS).toEqual(['data-heavy', 'narrative', 'memo']);
    expect(blueprint).toMatchObject({
      theme: 'consulting',
      profile: 'technical-report',
      definitions: 'technical-report-blocks.docx.json',
      numbering: 'sections',
      toc: true,
    });
  });

  it('takes its definitions from a template that defines the same blocks as the client report, and a memo header', () => {
    expect(Object.keys(definitions)).toEqual([
      'cover',
      'running-head',
      'section-opener',
      'key-takeaways',
      'callout',
      'data-table',
      'source-line',
      'figure-caption',
      'chart-figure',
      'footnotes',
      'memo-header',
    ]);
    expect(definitions['memo-header'].slots).toMatchObject({
      subject: { required: true, maxWords: 16 },
      to: { required: true },
      from: { required: true },
      date: { required: true },
      cc: { type: 'string' },
    });
    // The template's own document is a technical report on its own profile.
    expect(TEMPLATE.props).toMatchObject({
      theme: 'consulting',
      qualityProfile: 'technical-report',
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
          'running-head',
          'section-opener',
          'key-takeaways',
          'data-table',
          'callout',
          'footnotes',
          'source-line',
        ])
      );
      if (variant === 'memo') {
        expect(carried).toContain('memo-header');
        expect(carried).not.toContain('cover');
        expect(carried).not.toContain('chart-figure');
      } else {
        expect(carried).toContain('cover');
        expect(carried).not.toContain('memo-header');
      }
      expect(carried).toEqual(
        expect.arrayContaining(
          variant === 'data-heavy' ? ['chart-figure', 'figure-caption'] : []
        )
      );
      expect(fillMap.length).toBeGreaterThan(20);
      for (const entry of fillMap) {
        expect(valueAt(document, entry.path), entry.path).toBe(entry.marker);
        expect(entry.guidance.length).toBeGreaterThan(0);
      }
      expect(
        fillMap.find((entry) => entry.path === '/props/metadata/title')
      ).toMatchObject({ kind: 'metadata' });
      expect(
        fillMap.filter((entry) => entry.kind === 'text').length
      ).toBeGreaterThan(0);
      const table = fillMap.find(
        (entry) => entry.block === 'data-table' && entry.slot === 'source'
      );
      expect(table).toMatchObject({ kind: 'slot', type: 'string' });
    });

    it('is judged by its own profile without arguments, reports only draft markers, and renders warning-clean', async () => {
      const { document } = instantiateDocxBlueprint(blueprint, {
        variant,
        definitions,
      });
      const analysis = analyzeDocxQuality(document);
      expect(analysis.profileId).toBe('technical-report');
      expect(analysis.blocked).toBe(false);
      expect(new Set(analysis.diagnostics.map((d) => d.code))).toEqual(
        new Set([QUALITY_CODES.SCAFFOLD_MARKER])
      );
      const { warnings } = await generateBufferWithWarnings(document);
      expect(warnings).toEqual([]);
    });

    it('is generation-ready once every fill-map pointer is patched', () => {
      const { document } = filled(variant);
      expect(validateDocument(document).errors).toEqual([]);
      const findings = analyzeDocxQuality(document).diagnostics.filter(
        (finding) => finding.severity !== 'info'
      );
      expect(findings).toEqual([]);
    });

    it.each(THEMES)(
      'asks the same of the document on the %s theme, markers filled and the table source blanked',
      (theme) => {
        const blanked = (on: string | undefined) => {
          const { document, fillMap } = filled(variant, on);
          const source = fillMap.find(
            (entry) => entry.block === 'data-table' && entry.slot === 'source'
          )!;
          set(document, source.path, '');
          return document;
        };
        const document = blanked(theme);
        expect((document.props as { theme: string }).theme).toBe(theme);
        expect(validateDocument(document).errors).toEqual([]);
        const found = codes(document);
        expect(found).toContain(QUALITY_CODES.CHROME_MISSING);
        expect(found).toEqual(codes(blanked(undefined)));
      }
    );

    it('owes the source to the profile, not the theme, and never asks for a takeaway', () => {
      const { document, fillMap } = filled(variant);
      const sourced = fillMap.find(
        (entry) => entry.block === 'data-table' && entry.slot === 'source'
      )!;
      set(document, sourced.path, '');
      expect(codes(document)).toContain(QUALITY_CODES.CHROME_MISSING);
      expect(
        codes(document, { profile: { id: 'general', formats: ['docx'] } })
      ).not.toContain(QUALITY_CODES.CHROME_MISSING);
      if (variant === 'data-heavy') {
        const { document: withoutTakeaway, fillMap: map } = filled(variant);
        const takeaway = map.find(
          (entry) => entry.block === 'chart-figure' && entry.slot === 'takeaway'
        )!;
        set(withoutTakeaway, takeaway.path, '');
        expect(codes(withoutTakeaway)).not.toContain(
          QUALITY_CODES.CHROME_MISSING
        );
      }
      const props = document.props as Record<string, unknown>;
      expect(props.theme).toBe('consulting');
      expect(props.themeOverrides).toBeUndefined();
    });
  });

  it('numbers five sections under a contents list in the report variants, none in the memo', () => {
    for (const variant of ['data-heavy', 'narrative']) {
      const { document } = instantiateDocxBlueprint(blueprint, {
        variant,
        definitions,
      });
      const children = document.children as Array<{ children: unknown[] }>;
      expect(children).toHaveLength(6);
      expect(invocations(document).filter((ref) => ref === 'cover')).toEqual([
        'cover',
      ]);
      const body = children[1].children as Array<Record<string, unknown>>;
      expect(body[0]).toMatchObject({ props: { ref: 'running-head' } });
      expect(body[1]).toMatchObject({
        name: 'toc',
        props: {
          scope: 'document',
          title: 'Contents',
          depth: { from: 1, to: 2 },
        },
      });
      const numbers = children
        .slice(1)
        .map(
          (section) =>
            (section.children[0] as Record<string, unknown>).props as {
              ref: string;
              slots: { number: string };
            }
        )
        .map((props, index) =>
          index === 0
            ? (body[2].props as { slots: { number: string } }).slots.number
            : props.slots.number
        );
      expect(numbers).toEqual(['1', '2', '3', '4', '5']);
      expect(invocations(document).at(-1)).toBe('footnotes');
    }
    const { document: memo } = instantiateDocxBlueprint(blueprint, {
      variant: 'memo',
      definitions,
    });
    expect(memo.children).toHaveLength(1);
    expect(JSON.stringify(memo)).not.toContain('"toc"');
    expect(invocations(memo).slice(0, 3)).toEqual([
      'memo-header',
      'running-head',
      'key-takeaways',
    ]);
  });

  it('gives the memo its running head on the first page, and the reports theirs after the cover', async () => {
    const memo = await generateBufferWithWarnings(filled('memo').document);
    const sections = chrome(memo.buffer as Buffer);
    expect(sections).toHaveLength(1);
    expect(sections[0].header).toBe('the subject line');
    expect(sections[0].footer).toMatch(/PAGE.*NUMPAGES/s);
    // Every section carries the chrome: the profile can ask from section 0.
    expect(
      codes(filled('memo').document, {
        profile: {
          id: 'strict',
          formats: ['docx'],
          rules: {
            'docx/running-head': {
              parameters: {
                required: ['header', 'footer', 'pageNumber'],
                fromSection: 0,
              },
            },
          },
        },
      })
    ).not.toContain(QUALITY_CODES.CHROME_MISSING);

    const report = await generateBufferWithWarnings(
      filled('data-heavy').document
    );
    const pages = chrome(report.buffer as Buffer);
    expect(pages).toHaveLength(6);
    expect(pages[0]).toMatchObject({ header: undefined, footer: undefined });
    expect(pages[1].type).toBe('nextPage');
    expect(pages.slice(1).map((s) => s.header)).toEqual(
      Array(5).fill('as on the cover')
    );
    expect(pages.slice(2).map((s) => s.type)).toEqual(
      Array(4).fill('continuous')
    );
  });

  it('refuses a variant it does not have and a definition the template lacks', () => {
    expect(() =>
      instantiateDocxBlueprint(blueprint, { variant: 'letter', definitions })
    ).toThrow(/no variant "letter"/);
    const { 'memo-header': _memo, ...without } = definitions; // eslint-disable-line @typescript-eslint/no-unused-vars
    expect(() =>
      instantiateDocxBlueprint(blueprint, {
        variant: 'memo',
        definitions: without,
      })
    ).toThrow(/invokes "memo-header"/);
  });
});

const soffice = await findLibreOffice();
const pdftotext = await hasPdftotext();
requireIfInsisted(Boolean(soffice), 'a LibreOffice binary on PATH');
requireIfInsisted(pdftotext, 'pdftotext');

describe.skipIf(!soffice || !pdftotext)('rendered through LibreOffice', () => {
  it('lists the numbered sections in the contents, opens the memo with its header on page one, and paints n / N', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jto-technical-report-'));
    try {
      for (const variant of VARIANTS) {
        const { buffer } = await generateBufferWithWarnings(
          filled(variant).document
        );
        await writeFile(join(dir, `${variant}.docx`), buffer);
      }
      await run(
        soffice as string,
        [
          `-env:UserInstallation=file://${join(dir, 'profile').replace(/\\/g, '/')}`,
          '--headless',
          '--convert-to',
          'pdf',
          '--outdir',
          dir,
          ...VARIANTS.map((variant) => join(dir, `${variant}.docx`)),
        ],
        { timeout: 180_000 }
      );
      const text = async (variant: string) => {
        const pdf = join(dir, `${variant}.pdf`);
        await run('pdftotext', ['-layout', pdf, join(dir, `${variant}.txt`)]);
        return (await readFile(join(dir, `${variant}.txt`), 'utf8')).split(
          '\f'
        );
      };
      for (const variant of ['data-heavy', 'narrative']) {
        const pages = await text(variant);
        // The cover, then the contents list ahead of the first section, with
        // every numbered opener listed and painted.
        expect(pages[1]).toContain('Contents');
        const opener = 'the conclusion';
        expect(pages[1].indexOf('Contents')).toBeLessThan(
          pages[1].indexOf(opener)
        );
        // Every numbered opener is listed on the contents page, with its dot
        // leader, before it is painted in the body: the TOC is document-scoped,
        // not scoped to the section it sits in.
        const listed = pages[1]
          .split('\n')
          .filter((line) => /\.{4,}/.test(line))
          .join('\n');
        expect(listed.split('\n')).toHaveLength(
          variant === 'data-heavy' ? 7 : 5
        );
        expect(listed).toContain(opener);
        expect(listed).toMatch(/scope and method|context and constraints/);
        expect(listed).toMatch(/readiness or decision|recommendation and next/);
        if (variant === 'data-heavy')
          expect(listed).toMatch(/the first result[\s\S]*the second result/);
        expect(pages[1]).toMatch(/\b2\s*\/\s*\d+/);
      }
      const memo = (await text('memo')).filter((page) => page.trim());
      expect(memo.length).toBeLessThanOrEqual(3);
      // The memo label is painted in the eyebrow role, which the technical
      // themes set to upper case (#361); `minimal` would keep the authored case.
      expect(memo[0]).toMatch(/Technical memo/i);
      expect(memo[0].indexOf('To')).toBeLessThan(memo[0].indexOf('From'));
      expect(memo[0]).toContain('the person or group who decides');
      expect(memo[0]).toContain('Recommendation');
      expect(memo[0]).toMatch(/\b1\s*\/\s*\d+/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 240_000);
});
