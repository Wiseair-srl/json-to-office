/**
 * Content hierarchy and document integrity (#347): the checks that catch what
 * a reader trips over rather than what a theme paints. Every one is off until
 * a profile turns it on, every one names what it expected, and the two that
 * can be repaired mechanically carry the patch that repairs them.
 */
import { describe, expect, it } from 'vitest';
import { QUALITY_CODES } from '@json-to-office/quality';
import { analyzeDocxQuality } from './preflight';
import { block, example, para, section } from '../blocks/__tests__/example';

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
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAAEklEQVR42mOIrt34HxkzoAsAAE/xFEFoJgXRAAAAAElFTkSuQmCC';

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
  it('counts a heading or a contents field as something the section draws', () => {
    // The contents rule suggests a contents page of its own, and a divider
    // carries only its heading: neither renders nothing.
    const contents = report(
      section({ name: 'toc', props: { title: 'Contents' } }),
      section(heading('One'), para(words(80)))
    );
    expect(onReport(contents, QUALITY_CODES.SECTION_EMPTY)).toEqual([]);
    const divider = report(
      section(heading('Part one')),
      section(heading('One'), para(words(80)))
    );
    expect(onReport(divider, QUALITY_CODES.SECTION_EMPTY)).toEqual([]);
  });
  it('is asked for by the executive report too', () => {
    const empty = report(section(), section(heading('One'), para(words(80))));
    expect(
      findings(empty, QUALITY_CODES.SECTION_EMPTY, {
        profile: profile('executive-report'),
      })
    ).toEqual([expect.objectContaining({ path: '/children/0' })]);
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
  it('reports a measure too narrow to read, whichever the profile', () => {
    const narrow = report({
      name: 'section',
      props: { page: { size: 'A4', margins: { left: 4400, right: 4400 } } },
      children: [heading('One'), para(words(80))],
    });
    expect(onReport(narrow, QUALITY_CODES.BODY_MEASURE)).toEqual([
      expect.objectContaining({
        path: '/children/0',
        evidence: expect.objectContaining({ unit: 'characters' }),
      }),
    ]);
  });
  it('holds a caller who opts in directly to its own 45–90 characters', () => {
    // The report profiles judge at 125 because the bundled themes' own pages
    // run 97 to 121 characters a line; the rule's defaults stay book
    // typography for anyone who asks for the rule without a profile.
    const themePage = report(section(heading('One'), para(words(80))));
    const direct = findings(themePage, QUALITY_CODES.BODY_MEASURE, {
      policy: { rules: { 'docx/body-measure': { enabled: true } } },
    });
    expect(direct).toEqual([
      expect.objectContaining({
        context: expect.objectContaining({ minimum: 45, maximum: 90 }),
        evidence: expect.objectContaining({ expected: 90 }),
      }),
    ]);
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

describe('a heading that skips a level', () => {
  it('carries the level fix when the author wrote the heading, and none when a block did', () => {
    const authored = report(
      section(heading('One'), para(words(10)), heading('Deep', { level: 3 }))
    );
    const [own] = findings(authored, QUALITY_CODES.HEADING_SKIP);
    expect(own.fixes).toEqual([
      { op: 'add', path: '/children/0/children/2/props/level', value: 2 },
    ]);
    // A definition that draws a level-3 heading: its level is the
    // definition's. The pointer maps to the invocation, and an `add` there
    // would replace the block with a number.
    const doc = report(
      section(heading('One'), {
        name: 'block',
        props: { ref: 'deep', slots: { title: 'Deep' } },
      })
    );
    doc.props.blocks = {
      ...doc.props.blocks,
      deep: {
        slots: { title: { type: 'string', required: true } },
        body: [
          { name: 'heading', props: { text: { $slot: '/title' }, level: 3 } },
        ],
      },
    };
    const [generated] = findings(doc, QUALITY_CODES.HEADING_SKIP);
    expect(generated).toBeDefined();
    expect(generated.fixes).toBeUndefined();
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
  it('is cleared by a caption paragraph written right beside it, and only there', () => {
    const image = { name: 'image', props: { base64: PNG_4X2 } };
    const beside = report(
      section(heading('One'), image, para('Figure 1. The delivery model.'))
    );
    expect(onReport(beside, QUALITY_CODES.FIGURE_UNLABELLED)).toEqual([]);
    const away = report(
      section(
        heading('One'),
        image,
        para(words(20)),
        para(words(20)),
        para('Figure 2. Something else entirely.')
      )
    );
    expect(onReport(away, QUALITY_CODES.FIGURE_UNLABELLED)).toEqual([
      expect.objectContaining({ path: '/children/0/children/1' }),
    ]);
  });
  it('is cleared by the image’s own caption, and by a figure block’s', () => {
    const own = report(
      section(heading('One'), {
        name: 'image',
        props: { base64: PNG_4X2, caption: 'Figure 1. The delivery model.' },
      })
    );
    expect(onReport(own, QUALITY_CODES.FIGURE_UNLABELLED)).toEqual([]);
    // The report block writes its caption as a paragraph at the invocation,
    // not as a caption slot: the rule has to see that one too.
    const doc = example();
    doc.props.theme = 'consulting';
    doc.children = [
      section(
        block('figure', {
          image: { name: 'image', props: { base64: PNG_4X2 } },
          caption: 'The delivery model, in four stages.',
          source: 'Operating handbook, 2026.',
        })
      ),
    ];
    expect(onReport(doc, QUALITY_CODES.FIGURE_UNLABELLED)).toEqual([]);
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
  it('reads an inline SVG’s aspect off its viewBox, and says nothing about a file it cannot open', () => {
    const svg = report(
      section({
        name: 'image',
        props: {
          svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><rect width="200" height="100"/></svg>',
          alt: 'Diagram',
          width: 200,
          height: 200,
        },
      })
    );
    expect(findings(svg, QUALITY_CODES.IMAGE_ASPECT)).toEqual([
      expect.objectContaining({
        evidence: expect.objectContaining({ actual: 1, expected: 2 }),
      }),
    ]);
    const file = report(
      section({
        name: 'image',
        props: { path: 'assets/logo.png', alt: 'Logo', width: 260, height: 80 },
      })
    );
    expect(findings(file, QUALITY_CODES.IMAGE_ASPECT)).toEqual([]);
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
  it('is reported from the threshold itself, not only past it', () => {
    const at = (count: number) =>
      findings(many(count), QUALITY_CODES.CONTENTS_MISSING, {
        profile: profile('technical-report'),
      });
    expect(at(7)).toEqual([]);
    expect(at(8)).toEqual([
      expect.objectContaining({
        evidence: expect.objectContaining({ actual: 8, expected: 8 }),
      }),
    ]);
  });
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
