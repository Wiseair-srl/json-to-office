import { describe, it, expect } from 'vitest';
import {
  buildOutline,
  collectErrorNodeIds,
  computeReorderEdit,
  findDeepestNodeAt,
  type OutlineNode,
} from '../document-outline';

const pptxDoc = JSON.stringify(
  {
    name: 'pptx',
    props: { title: 'Deck', theme: 'corporate' },
    children: [
      {
        name: 'slide',
        props: { notes: 'intro notes' },
        children: [
          {
            name: 'text',
            props: { text: 'Q2 Review\nSubline', style: 'title' },
          },
          { name: 'shape', props: { type: 'line' } },
        ],
      },
      {
        name: 'slide',
        children: [
          { name: 'text', props: { text: 'Performance', style: 'heading1' } },
          {
            name: 'chart',
            props: { type: 'bar', title: 'Revenue ($k)', data: [] },
          },
          {
            name: 'table',
            props: {
              rows: [
                ['a', 'b', 'c'],
                ['d', 'e', 'f'],
              ],
            },
          },
        ],
      },
      {
        name: 'slide',
        children: [
          { name: 'image', props: { src: 'https://x.test/logo.png' } },
        ],
      },
    ],
  },
  null,
  2
);

const docxDoc = JSON.stringify(
  {
    name: 'docx',
    props: { theme: 'minimal' },
    children: [
      { name: 'heading', props: { text: 'Agreement', level: 1 } },
      { name: 'paragraph', props: { text: 'Intro paragraph.' } },
      { name: 'heading', props: { text: 'Fees', level: 2 } },
      { name: 'paragraph', props: { text: 'Fees paragraph.' } },
      { name: 'list', props: { items: ['a', 'b', 'c'] } },
      { name: 'heading', props: { text: 'Termination', level: 2 } },
      { name: 'paragraph', props: { text: 'Termination paragraph.' } },
      { name: 'heading', props: { text: 'Annex', level: 1 } },
      {
        name: 'table',
        props: { columns: [{ header: 'H', cells: ['1', '2'] }] },
      },
    ],
  },
  null,
  2
);

describe('buildOutline (pptx)', () => {
  const outline = buildOutline(pptxDoc, 'pptx', 'document');

  it('lists slides with title-derived labels', () => {
    expect(outline).toHaveLength(3);
    expect(outline[0].kind).toBe('slide');
    expect(outline[0].label).toBe('Q2 Review Subline');
    expect(outline[1].label).toBe('Performance');
    expect(outline[2].label).toBe('Slide 3');
  });

  it('labels components semantically', () => {
    const slide2 = outline[1];
    expect(slide2.children.map((c) => c.kind)).toEqual([
      'text',
      'chart',
      'table',
    ]);
    expect(slide2.children[1].label).toBe('Revenue ($k)');
    expect(slide2.children[1].detail).toBe('bar');
    expect(slide2.children[2].detail).toBe('2×3');
    expect(outline[2].children[0].label).toBe('logo.png');
  });

  it('assigns nested ids and containment ranges', () => {
    const slide2 = outline[1];
    expect(slide2.children[0].id).toBe('1.0');
    for (const child of slide2.children) {
      expect(child.start).toBeGreaterThanOrEqual(slide2.start);
      expect(child.end).toBeLessThanOrEqual(slide2.end);
    }
  });

  it('marks slides reorderable within one group', () => {
    const groups = new Set(outline.map((n) => n.reorder?.groupId));
    expect(groups.size).toBe(1);
    expect([...groups][0]).toBeTruthy();
  });

  it('prefers meta.title over content-derived labels', () => {
    const doc = JSON.stringify({
      name: 'pptx',
      children: [
        {
          name: 'slide',
          props: { meta: { title: 'Cover' } },
          children: [
            { name: 'text', props: { text: 'Something else', style: 'title' } },
          ],
        },
      ],
    });
    const slides = buildOutline(doc, 'pptx', 'document');
    expect(slides[0].label).toBe('Cover');
  });

  it('labels block-driven slides from their title slot', () => {
    const doc = JSON.stringify({
      name: 'pptx',
      props: { blocks: { cover: { slots: {}, body: [] } } },
      children: [
        {
          name: 'slide',
          children: [
            {
              name: 'block',
              props: {
                ref: 'cover',
                slots: {
                  subtitle: 'The subtitle',
                  title: 'Slide system\nshowcase',
                },
              },
            },
          ],
        },
      ],
    });
    const slides = buildOutline(doc, 'pptx', 'document');
    expect(slides[0].label).toBe('Slide system showcase');
  });
});

describe('buildOutline (docx)', () => {
  const outline = buildOutline(docxDoc, 'docx', 'document');

  it('builds a heading hierarchy', () => {
    expect(outline.map((n) => n.label)).toEqual(['Agreement', 'Annex']);
    const agreement = outline[0];
    expect(agreement.children.map((n) => n.label)).toEqual([
      'Intro paragraph.',
      'Fees',
      'Termination',
    ]);
    expect(agreement.children[1].children.map((n) => n.kind)).toEqual([
      'paragraph',
      'list',
    ]);
  });

  it('extends heading ranges and slices over their sections', () => {
    const agreement = outline[0];
    const termination = agreement.children[2];
    const lastPara = termination.children[0];
    expect(termination.end).toBeGreaterThanOrEqual(lastPara.end);
    expect(termination.reorder!.sliceEnd).toBeGreaterThanOrEqual(lastPara.end);
    expect(agreement.reorder!.sliceEnd).toBeGreaterThanOrEqual(
      termination.reorder!.sliceEnd
    );
  });

  it('finds the deepest node at an offset', () => {
    const feesPara = outline[0].children[1].children[0];
    const hit = findDeepestNodeAt(outline, feesPara.start + 5);
    expect(hit?.id).toBe(feesPara.id);
  });

  it('labels sections from meta.title when present', () => {
    const doc = JSON.stringify({
      name: 'docx',
      children: [
        {
          name: 'section',
          props: { meta: { title: 'Financial Highlights' } },
          children: [
            { name: 'heading', props: { text: 'Something else', level: 2 } },
          ],
        },
      ],
    });
    const sections = buildOutline(doc, 'docx', 'document');
    expect(sections[0].label).toBe('Financial Highlights');
  });

  it('labels untitled sections from their first heading child', () => {
    const doc = JSON.stringify({
      name: 'docx',
      children: [
        {
          name: 'section',
          props: { pageBreak: true },
          children: [
            { name: 'heading', props: { text: 'Market analysis', level: 2 } },
            { name: 'paragraph', props: { text: 'Body.' } },
          ],
        },
      ],
    });
    const sections = buildOutline(doc, 'docx', 'document');
    expect(sections[0].kind).toBe('section');
    expect(sections[0].label).toBe('Market analysis');
  });
});

describe('buildOutline (theme)', () => {
  const theme = JSON.stringify(
    {
      $schema: 'x',
      name: 'corporate',
      colors: { primary: '#1B4B66', accent: '#F05A28' },
      fonts: { heading: { family: 'Inter' } },
      noProofWords: ['Wiseair'],
    },
    null,
    2
  );
  const outline = buildOutline(theme, 'docx', 'theme');

  it('lists top-level keys (skipping $schema) with nested keys one level down', () => {
    expect(outline.map((n) => n.label)).toEqual([
      'name',
      'colors',
      'fonts',
      'noProofWords',
    ]);
    const colors = outline[1];
    expect(colors.children.map((n) => n.label)).toEqual(['primary', 'accent']);
    expect(colors.children[0].detail).toBe('#1B4B66');
    expect(outline[3].detail).toBe('1 items');
  });
});

describe('error tolerance', () => {
  it('still outlines a document with a syntax error', () => {
    const broken = pptxDoc.replace('"type": "bar",', '"type": "bar",,');
    const outline = buildOutline(broken, 'pptx', 'document');
    expect(outline.length).toBe(3);
    expect(outline[0].label).toBe('Q2 Review Subline');
  });

  it('returns [] for empty or hopeless input', () => {
    expect(buildOutline('', 'pptx', 'document')).toEqual([]);
    expect(buildOutline('not json at all', 'pptx', 'document')).toEqual([]);
  });

  it('strips collapse sentinels from labels', () => {
    const doc = JSON.stringify({
      name: 'docx',
      children: [{ name: 'paragraph', props: { text: 'head §jtoc:3§ tail' } }],
    });
    const outline = buildOutline(doc, 'docx', 'document');
    expect(outline[0].label).toBe('head … tail');
  });
});

describe('collectErrorNodeIds', () => {
  it('marks the deepest node and all ancestors', () => {
    const outline = buildOutline(pptxDoc, 'pptx', 'document');
    const chart = outline[1].children[1];
    const ids = collectErrorNodeIds(outline, [chart.start + 3]);
    expect(ids.has(chart.id)).toBe(true);
    expect(ids.has(outline[1].id)).toBe(true);
    expect(ids.has(outline[0].id)).toBe(false);
  });
});

describe('computeReorderEdit', () => {
  function apply(
    text: string,
    edit: { start: number; end: number; text: string }
  ) {
    return text.slice(0, edit.start) + edit.text + text.slice(edit.end);
  }

  it('moves a pptx slide and keeps the JSON valid and complete', () => {
    const outline = buildOutline(pptxDoc, 'pptx', 'document');
    const edit = computeReorderEdit(pptxDoc, outline, 0, 2);
    expect(edit).not.toBeNull();
    const next = apply(pptxDoc, edit!);
    const parsed = JSON.parse(next);
    const labels = buildOutline(next, 'pptx', 'document').map((n) => n.label);
    expect(labels).toEqual(['Performance', 'Slide 2', 'Q2 Review Subline']);
    expect(parsed.children).toHaveLength(3);
  });

  it('moves a docx heading section with all its content', () => {
    const outline = buildOutline(docxDoc, 'docx', 'document');
    const agreement = outline[0];
    // Move "Fees" (index 1 among Agreement's children) after "Termination"
    const edit = computeReorderEdit(docxDoc, agreement.children, 1, 2);
    const next = apply(docxDoc, edit!);
    const parsed = JSON.parse(next);
    const names = parsed.children.map(
      (c: { name: string; props?: { text?: string } }) =>
        c.props?.text ?? c.name
    );
    expect(names).toEqual([
      'Agreement',
      'Intro paragraph.',
      'Termination',
      'Termination paragraph.',
      'Fees',
      'Fees paragraph.',
      'list',
      'Annex',
      'table',
    ]);
  });

  it('preserves inter-item separators verbatim', () => {
    const compact =
      '{"name":"pptx","children":[{"name":"slide"},  {"name":"slide","props":{"notes":"b"}},\n{"name":"slide","props":{"notes":"c"}}]}';
    const outline = buildOutline(compact, 'pptx', 'document');
    const edit = computeReorderEdit(compact, outline, 2, 0);
    const next = apply(compact, edit!);
    expect(JSON.parse(next).children.map((s: any) => s.props?.notes)).toEqual([
      'c',
      undefined,
      'b',
    ]);
    // The two separator strings (",  " and ",\n") must both survive.
    expect(next).toContain(',  ');
    expect(next).toContain(',\n');
  });

  it('refuses no-ops, cross-group moves, and suspicious separators', () => {
    const outline = buildOutline(pptxDoc, 'pptx', 'document');
    expect(computeReorderEdit(pptxDoc, outline, 1, 1)).toBeNull();
    expect(computeReorderEdit(pptxDoc, outline, 0, 99)).toBeNull();
    const mixed: OutlineNode[] = [
      outline[0],
      { ...outline[1], reorder: { ...outline[1].reorder!, groupId: 'other' } },
    ];
    expect(computeReorderEdit(pptxDoc, mixed, 0, 1)).toBeNull();
  });
});
