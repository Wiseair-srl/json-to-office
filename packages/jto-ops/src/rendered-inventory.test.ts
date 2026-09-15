import { describe, expect, it } from 'vitest';
import type { QualityFact } from '@json-to-office/quality';
import {
  renderedInventoryFromFacts,
  requestedFontsFromFacts,
} from './rendered-inventory';

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

describe('renderedInventoryFromFacts', () => {
  it('turns docx text facts into entries with role, repetition and frame box', () => {
    expect(renderedInventoryFromFacts('docx', facts)).toEqual([
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
      renderedInventoryFromFacts('pptx', [
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

  it("places slide text on its slide's page and in its box, and leaves a hidden slide's text out", () => {
    expect(
      renderedInventoryFromFacts('pptx', [
        {
          id: 'visible',
          kind: 'pptx/text',
          path: '/children/2/children/0',
          page: 1,
          text: 'Revenue',
          boxXPt: 658,
          boxYPt: 24,
          boxWidthPt: 266,
          boxHeightPt: 22,
        } as QualityFact,
        {
          id: 'hidden',
          kind: 'pptx/text',
          path: '/children/1/children/0',
          slideHidden: true,
          text: 'Hidden appendix note',
        } as QualityFact,
      ])
    ).toEqual([
      {
        path: '/children/2/children/0',
        text: 'Revenue',
        role: 'slide-text',
        page: 1,
        region: { xMin: 658, yMin: 24, xMax: 924, yMax: 46 },
        box: { widthPt: 266, heightPt: 22 },
      },
    ]);
  });

  it('holds text set at an angle to no box, and never calls it missing', () => {
    expect(
      renderedInventoryFromFacts('pptx', [
        {
          id: 'turned',
          kind: 'pptx/text',
          path: '/children/11/children/2',
          page: 11,
          text: 'VALUE ONE',
          rotationDeg: 300,
          boxXPt: 458,
          boxYPt: 222,
          boxWidthPt: 194,
          boxHeightPt: 34,
        } as QualityFact,
      ])
    ).toEqual([
      {
        path: '/children/11/children/2',
        text: 'VALUE ONE',
        role: 'slide-text',
        optional: true,
        page: 11,
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
