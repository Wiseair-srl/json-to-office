/**
 * Content hierarchy and document integrity (#347): the checks that catch what
 * a reader trips over rather than what a theme paints. Every one is off until
 * a profile turns it on, every one names what it expected, and the two that
 * can be repaired mechanically carry the patch that repairs them.
 */
import { describe, expect, it } from 'vitest';
import { QUALITY_CODES } from '@json-to-office/quality';
import { analyzeDocxQuality } from './preflight';
import { example, para, section } from '../blocks/__tests__/example';

const profile = (id: string) => ({ id, formats: ['docx'] });
const findings = (doc: unknown, code: string, options = {}) =>
  analyzeDocxQuality(doc, options).diagnostics.filter(
    (finding) => finding.code === code
  );
const onReport = (doc: unknown, code: string) =>
  findings(doc, code, { profile: profile('client-report') });
/** A consulting report holding the given sections. */
const report = (...sections: unknown[]) => {
  const doc = example();
  doc.props.theme = 'consulting';
  doc.children = sections;
  return doc;
};
const words = (n: number) =>
  Array.from({ length: n }, (_, i) => `word${i + 1}`).join(' ');
const heading = (text: string, extra: Record<string, unknown> = {}) => ({
  name: 'heading',
  props: { text, level: 1, ...extra },
});
const PNG_4X2 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAABytg0kAAAAFElEQVR42mNk+M9QzwAFjDAGACPuA/8fMSCgAAAAAElFTkSuQmCC';

describe('a section with nothing in it', () => {
  it('is reported once a profile asks, and never on a section that draws something', () => {
    const empty = report(section(), section(heading('One'), para(words(80))));
    expect(findings(empty, QUALITY_CODES.SECTION_EMPTY)).toEqual([]);
    expect(onReport(empty, QUALITY_CODES.SECTION_EMPTY)).toEqual([
      expect.objectContaining({ path: '/children/0' }),
    ]);
    const filled = report(section(heading('One'), para(words(80))));
    expect(onReport(filled, QUALITY_CODES.SECTION_EMPTY)).toEqual([]);
  });
});

describe('a section no heading opens', () => {
  it('is reported once it runs long enough to be read', () => {
    const untitled = report(section(para(words(80))));
    expect(findings(untitled, QUALITY_CODES.SECTION_UNTITLED)).toEqual([]);
    expect(onReport(untitled, QUALITY_CODES.SECTION_UNTITLED)).toEqual([
      expect.objectContaining({
        path: '/children/0',
        evidence: expect.objectContaining({ actual: 0, expected: 1 }),
      }),
    ]);
  });
  it('leaves a cover’s few words alone', () => {
    const cover = report(
      section(para('Quarterly review'), para('Confidential'))
    );
    expect(onReport(cover, QUALITY_CODES.SECTION_UNTITLED)).toEqual([]);
  });
});

describe('the measure body copy runs at', () => {
  it('reports a page whose margins leave the line too long', () => {
    const wide = report({
      name: 'section',
      props: { page: { size: 'LETTER', margins: { left: 180, right: 180 } } },
      children: [heading('One'), para(words(80))],
    });
    expect(findings(wide, QUALITY_CODES.BODY_MEASURE)).toEqual([]);
    expect(onReport(wide, QUALITY_CODES.BODY_MEASURE)).toEqual([
      expect.objectContaining({
        path: '/children/0',
        certainty: 'estimated',
        evidence: expect.objectContaining({ unit: 'characters' }),
      }),
    ]);
  });
  it('says nothing about the theme’s own page', () => {
    expect(
      onReport(
        report(section(heading('One'), para(words(80)))),
        QUALITY_CODES.BODY_MEASURE
      )
    ).toEqual([]);
  });
});

describe('a heading loose from what follows it', () => {
  it('is reported with the property that binds it, and the patch clears it', () => {
    const loose = report(
      section(heading('One', { keepNext: false }), para(words(40)))
    );
    expect(findings(loose, QUALITY_CODES.HEADING_ORPHAN)).toEqual([]);
    const [found] = onReport(loose, QUALITY_CODES.HEADING_ORPHAN);
    expect(found).toMatchObject({
      path: '/children/0/children/0',
      fixes: [
        {
          op: 'add',
          path: '/children/0/children/0/props/keepNext',
          value: true,
        },
      ],
    });
    const bound = report(section(heading('One'), para(words(40))));
    expect(onReport(bound, QUALITY_CODES.HEADING_ORPHAN)).toEqual([]);
  });
});

describe('a figure nothing names', () => {
  it('is reported with neither caption nor alt text, and cleared by either', () => {
    const bare = report(
      section(heading('One'), { name: 'image', props: { base64: PNG_4X2 } })
    );
    expect(findings(bare, QUALITY_CODES.FIGURE_UNLABELLED)).toEqual([]);
    expect(onReport(bare, QUALITY_CODES.FIGURE_UNLABELLED)).toEqual([
      expect.objectContaining({ path: '/children/0/children/1' }),
    ]);
    const described = report(
      section(heading('One'), {
        name: 'image',
        props: { base64: PNG_4X2, alt: 'Delivery model' },
      })
    );
    expect(onReport(described, QUALITY_CODES.FIGURE_UNLABELLED)).toEqual([]);
  });
});

describe('an image drawn out of shape', () => {
  it('is reported against the asset the document carries, on any profile', () => {
    const stretched = report(
      section({
        name: 'image',
        props: { base64: PNG_4X2, alt: 'Logo', width: 260, height: 80 },
      })
    );
    expect(findings(stretched, QUALITY_CODES.IMAGE_ASPECT)).toEqual([
      expect.objectContaining({
        path: '/children/0/children/0',
        evidence: expect.objectContaining({ actual: 3.25, expected: 2 }),
      }),
    ]);
  });
  it('says nothing when the drawn shape is the asset’s', () => {
    const honest = report(
      section({
        name: 'image',
        props: { base64: PNG_4X2, alt: 'Logo', width: 200, height: 100 },
      })
    );
    expect(findings(honest, QUALITY_CODES.IMAGE_ASPECT)).toEqual([]);
  });
  it('says nothing when only one side is stated', () => {
    const derived = report(
      section({
        name: 'image',
        props: { base64: PNG_4X2, alt: 'Logo', width: 200 },
      })
    );
    expect(findings(derived, QUALITY_CODES.IMAGE_ASPECT)).toEqual([]);
  });
});

describe('a document with no way in', () => {
  const many = (count: number) =>
    report(
      section(
        ...Array.from({ length: count }, (_, i) => [
          heading(`Section ${i + 1}`),
          para(words(30)),
        ]).flat()
      )
    );
  it('is reported past the profile’s heading threshold', () => {
    expect(findings(many(9), QUALITY_CODES.CONTENTS_MISSING)).toEqual([]);
    expect(
      findings(many(9), QUALITY_CODES.CONTENTS_MISSING, {
        profile: profile('technical-report'),
      })
    ).toEqual([
      expect.objectContaining({
        path: '/props',
        evidence: expect.objectContaining({ actual: 9, expected: 8 }),
      }),
    ]);
  });
  it('is silent under the threshold, and once a contents is there', () => {
    expect(
      findings(many(4), QUALITY_CODES.CONTENTS_MISSING, {
        profile: profile('technical-report'),
      })
    ).toEqual([]);
    const withToc = many(9);
    withToc.children[0].children.unshift({ name: 'toc', props: {} });
    expect(
      findings(withToc, QUALITY_CODES.CONTENTS_MISSING, {
        profile: profile('technical-report'),
      })
    ).toEqual([]);
  });
});
