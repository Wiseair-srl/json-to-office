/**
 * The rendered pass as `jto_preview` wires it (#344): authored inventory and
 * requested fonts read off the prepared facts, findings mapped through them.
 * Geometry is captured, so no converter runs here.
 */

import { describe, expect, it } from 'vitest';
import type { PdfTextPage } from '@json-to-office/jto-ops';
import type { QualityFact } from '@json-to-office/quality';

import {
  collectRenderedFindings,
  inventoryFromFacts,
  requestedFontsFromFacts,
} from '../preview/rendered-findings.js';
import { PREVIEW_ERROR_CODES } from '../preview/codes.js';

const facts: QualityFact[] = [
  {
    id: 'docx:text:/children/0/props/text',
    kind: 'docx/text',
    path: '/children/0/props/text',
    text: 'Client report',
    role: 'chrome',
    repeats: true,
    order: 0,
  } as QualityFact,
  {
    id: 'docx:text:/children/1/props/text',
    kind: 'docx/text',
    path: '/children/1/props/text',
    text: 'Results',
    role: 'heading',
    level: 2,
    order: 1,
  } as QualityFact,
  {
    id: 'docx:text:/children/2/props/text',
    kind: 'docx/text',
    path: '/children/2/props/text',
    text: 'Framed note',
    role: 'body',
    order: 2,
    frame: { widthPt: 100, heightPt: 20 },
  } as QualityFact,
  {
    id: 'docx:font:0:/theme/fonts/body',
    kind: 'docx/font-family',
    path: '/theme/fonts/body',
    family: 'Inter',
  } as QualityFact,
];

const page: PdfTextPage = {
  widthPt: 595,
  heightPt: 842,
  words: [
    { text: 'Client', xMin: 10, yMin: 10, xMax: 40, yMax: 22 },
    { text: 'report', xMin: 44, yMin: 10, xMax: 74, yMax: 22 },
    { text: 'Results', xMin: 10, yMin: 100, xMax: 50, yMax: 112 },
    { text: 'Framed', xMin: 10, yMin: 200, xMax: 50, yMax: 212 },
    { text: 'note', xMin: 10, yMin: 230, xMax: 40, yMax: 242 },
  ],
  lines: [],
};

describe('inventoryFromFacts', () => {
  it('turns docx text facts into entries with role, repetition and frame box', () => {
    expect(inventoryFromFacts('docx', facts)).toEqual([
      {
        path: '/children/0/props/text',
        text: 'Client report',
        role: 'chrome',
        repeats: true,
      },
      {
        path: '/children/1/props/text',
        text: 'Results',
        role: 'heading',
        level: 2,
      },
      {
        path: '/children/2/props/text',
        text: 'Framed note',
        role: 'body',
        box: { widthPt: 100, heightPt: 20 },
      },
    ]);
  });

  it('turns pptx text facts into slide entries with their declared box', () => {
    expect(
      inventoryFromFacts('pptx', [
        {
          id: 't',
          kind: 'pptx/text',
          path: '/children/0/children/1',
          text: 'Title',
          boxWidthPt: 400,
          boxHeightPt: 60,
        } as QualityFact,
      ])
    ).toEqual([
      {
        path: '/children/0/children/1',
        text: 'Title',
        role: 'slide-text',
        box: { widthPt: 400, heightPt: 60 },
      },
    ]);
  });
});

describe('requestedFontsFromFacts', () => {
  it('lists authored families with pointers first, then resolved ones, without repeats', () => {
    expect(
      requestedFontsFromFacts('docx', facts, [
        { family: 'inter', declared: true },
        { family: 'DM Sans', declared: true },
        { family: 'Courier New', declared: false },
      ])
    ).toEqual([
      { family: 'Inter', path: '/theme/fonts/body', declared: true },
      { family: 'DM Sans', declared: true },
    ]);
  });
});

describe('collectRenderedFindings', () => {
  const adapter = {
    prepareDocument: async () => ({
      format: 'docx',
      model: {},
      facts,
      provenance: {},
    }),
  };

  it('maps findings to authored pointers and summarises the pass', async () => {
    const result = await collectRenderedFindings({
      format: 'docx',
      document: {},
      render: {},
      rendered: {
        pages: [page],
        fonts: [
          {
            name: 'AAAAAA+DejaVuSans',
            baseName: 'DejaVuSans',
            type: 'TrueType',
            embedded: true,
          },
        ],
        resolvedFonts: [{ family: 'Inter', declared: true }],
      },
      adapter,
    });
    expect(
      result.diagnostics.map((d) => [d.code, d.path, d.context?.mapping])
    ).toEqual([
      ['W_QUALITY_RENDERED_SPILL', '/children/2/props/text', 'mapped'],
      ['W_QUALITY_RENDERED_FONT_SUBSTITUTED', '/theme/fonts/body', 'mapped'],
    ]);
    expect(result.diagnostics[0]).toMatchObject({
      source: 'quality',
      certainty: 'rendered',
      blocking: false,
      severity: 'warning',
    });
    expect(result.summary).toMatchObject({
      pages: 1,
      words: 5,
      inventory: { mapped: 3, missing: 0 },
      fonts: { requested: 1, substituted: 1 },
      suppressed: 0,
      blocked: false,
    });
  });

  it('reads the inventory off a prepared document handed in, without preparing again', async () => {
    const result = await collectRenderedFindings({
      format: 'docx',
      document: {},
      render: {},
      rendered: { pages: [page], resolvedFonts: [] },
      prepared: { format: 'docx', model: {}, facts, provenance: {} },
      adapter: {
        prepareDocument: async () => {
          throw new Error('prepared twice');
        },
      },
    });
    expect(result.diagnostics.map((d) => d.code)).toEqual([
      'W_QUALITY_RENDERED_SPILL',
    ]);
  });

  it('applies the caller profile and policy: disabled rules, suppressions, gate', async () => {
    const result = await collectRenderedFindings({
      format: 'docx',
      document: {},
      render: {},
      rendered: {
        pages: [
          {
            ...page,
            words: [
              ...page.words,
              { text: 'stray', xMin: 580, yMin: 300, xMax: 620, yMax: 312 },
            ],
          },
        ],
        resolvedFonts: [],
      },
      adapter,
      quality: {
        profile: {
          id: 'preview-test',
          formats: ['docx'],
          rules: { 'rendered/spill': { enabled: false } },
        },
        policy: {
          gate: 'warning',
          suppressions: [
            { code: 'W_QUALITY_RENDERED_CLIP', reason: 'known stray' },
          ],
        },
      },
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.summary).toMatchObject({
      suppressed: 1,
      blocked: false,
      profileId: 'preview-test',
    });
  });

  it('marks findings blocking under a gate and says so in the summary', async () => {
    const result = await collectRenderedFindings({
      format: 'docx',
      document: {},
      render: {},
      rendered: { pages: [page], resolvedFonts: [] },
      adapter,
      quality: { policy: { gate: 'warning' } },
    });
    expect(result.diagnostics[0]).toMatchObject({
      code: 'W_QUALITY_RENDERED_SPILL',
      blocking: true,
    });
    expect(result.summary?.blocked).toBe(true);
  });

  it('judges by the profile the document declares, merged over the shipped one', async () => {
    const result = await collectRenderedFindings({
      format: 'docx',
      document: { name: 'docx', props: { qualityProfile: 'client-report' } },
      render: {},
      rendered: { pages: [page], resolvedFonts: [] },
      adapter,
      quality: {
        profile: {
          id: 'client-report',
          rules: { 'rendered/spill': { severity: 'info' } },
        },
      },
    });
    expect(result.diagnostics[0]).toMatchObject({
      code: 'W_QUALITY_RENDERED_SPILL',
      severity: 'info',
    });
    expect(result.summary?.profileId).toBe('client-report');
  });

  it('falls back to the format default profile when nobody names one', async () => {
    const result = await collectRenderedFindings({
      format: 'docx',
      document: { name: 'docx' },
      render: {},
      rendered: { pages: [page], resolvedFonts: [] },
      adapter,
    });
    expect(result.summary?.profileId).toBe('technical-report');
  });

  it('reports an unusable policy as an option defect, not a crash', async () => {
    const result = await collectRenderedFindings({
      format: 'docx',
      document: {},
      render: {},
      rendered: { pages: [page], resolvedFonts: [] },
      adapter,
      quality: { policy: { gate: 'loud' as never } },
    });
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: 'E_INVALID_QUALITY_POLICY' }),
    ]);
    expect(result.summary).toBeUndefined();
  });

  it('drops the root path from an unmapped finding rather than pointing at ""', async () => {
    const result = await collectRenderedFindings({
      format: 'docx',
      document: {},
      render: {},
      rendered: {
        pages: [
          {
            ...page,
            words: [
              { text: 'stray', xMin: 580, yMin: 100, xMax: 620, yMax: 112 },
            ],
          },
        ],
        resolvedFonts: [],
      },
      adapter,
    });
    const clip = result.diagnostics.find(
      (d) => d.code === 'W_QUALITY_RENDERED_CLIP'
    );
    expect(clip).toBeDefined();
    expect(clip).not.toHaveProperty('path');
    expect(clip?.context?.mapping).toBe('unmapped');
  });

  it('reports a document that cannot be prepared as a skipped pass, not a crash', async () => {
    const result = await collectRenderedFindings({
      format: 'docx',
      document: {},
      render: {},
      rendered: { pages: [page], resolvedFonts: [] },
      adapter: {
        prepareDocument: async () => {
          throw new Error('boom');
        },
      },
    });
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: PREVIEW_ERROR_CODES.RENDERED_UNAVAILABLE,
        severity: 'warning',
      }),
    ]);
    expect(result.summary).toBeUndefined();
  });
});
