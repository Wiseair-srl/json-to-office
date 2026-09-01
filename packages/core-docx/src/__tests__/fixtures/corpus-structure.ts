/**
 * DOCX parity corpus — document and section structure.
 *
 * Everything that decides where a page starts, how big it is, what runs in its
 * header and footer, and how many columns the text flows down. The body
 * components here are deliberately dull: a case fails on a structural change,
 * not on a paragraph one.
 *
 * Determinism: no clocks. The two cases that exercise the {DATE}/{DATETIME}/
 * {YEAR} placeholders pin `metadata.date`, which is what those placeholders
 * read before falling back to the generation timestamp.
 */

import type { CorpusCase } from './corpus-types';

/** A 4x2 PNG, small enough to inline and big enough to have an aspect ratio. */
const PNG_4X2 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAABytg0kAAAAFElEQVR42mNk+M9QzwAFjDAGACPuA/8fMSCgAAAAAElFTkSuQmCC';

const doc = (
  children: unknown[],
  props: Record<string, unknown> = {}
): unknown => ({ name: 'docx', props, children });

const section = (
  children: unknown[],
  props: Record<string, unknown> = {}
): unknown => ({ name: 'section', props, children });

const p = (text: string, props: Record<string, unknown> = {}): unknown => ({
  name: 'paragraph',
  props: { text, ...props },
});

const h = (text: string, level = 1): unknown => ({
  name: 'heading',
  props: { text, level },
});

/** Enough prose to make a multi-column section actually flow. */
const FILLER =
  'Structure corpus filler text used to give the layout engine something to break across columns and pages without depending on any paragraph-level feature.';

const columns = (
  props: Record<string, unknown>,
  children: unknown[]
): unknown => ({ name: 'columns', props, children });

/** A two-column table, dense enough to exercise header/footer table rendering. */
const MINI_TABLE = {
  name: 'table',
  props: {
    width: 100,
    columns: [
      { width: '50%', header: { content: 'Doc' }, cells: [{ content: 'Ref' }] },
      { width: '50%', header: { content: 'Rev' }, cells: [{ content: '3' }] },
    ],
  },
};

export const CASES: CorpusCase[] = [
  // ---------------------------------------------------------------------------
  // Document root
  // ---------------------------------------------------------------------------
  {
    // Every default at once: no root props, no section props, one paragraph.
    name: 'structure/minimal',
    document: doc([section([p('Minimal.')])]),
  },
  {
    // Every metadata slot filled; several land in docProps/custom.xml.
    name: 'structure/metadata-full',
    document: doc([section([p('Metadata.')])], {
      metadata: {
        title: 'Corpus Structure',
        subtitle: 'Sections and pages',
        description: 'A document exercising every metadata slot.',
        author: 'JTO',
        company: 'JTO Corp',
        date: '2020-01-02T03:04:05.000Z',
        version: '1.0',
        tags: ['corpus', 'structure'],
      },
    }),
  },
  {
    // Empty values: a present-but-empty metadata object, an empty tag list, and
    // empty strings — none of which should be confused with "absent".
    name: 'structure/metadata-empty',
    document: doc([section([p('')], { meta: {} })], {
      metadata: { title: '', author: '', tags: [] },
    }),
  },
  {
    // A named theme is the only source of document-level page size and margins:
    // `themeOverrides` cannot reach the page block.
    name: 'structure/theme-page-source',
    document: doc([section([p('Devportal page block.')])], {
      theme: 'devportal',
    }),
  },

  // ---------------------------------------------------------------------------
  // Section boundaries
  // ---------------------------------------------------------------------------
  {
    // Three sections, default pageBreak (true): three next-page breaks.
    name: 'structure/sections-multiple',
    document: doc([
      section([h('One'), p(FILLER)], { meta: { title: 'One' } }),
      section([h('Two'), p(FILLER)], { meta: { title: 'Two' } }),
      section([h('Three'), p(FILLER)], { meta: { title: 'Three' } }),
    ]),
  },
  {
    // pageBreak: false everywhere — continuous section types after the first.
    name: 'structure/section-page-break-off',
    document: doc([
      section([p('First runs on page one.')], { pageBreak: false }),
      section([p('Second continues on the same page.')], { pageBreak: false }),
      section([p('Third too.')], { pageBreak: false }),
    ]),
  },
  {
    // Mixed: explicit true, explicit false, and omitted (defaults to true).
    name: 'structure/section-page-break-mixed',
    document: doc([
      section([p('Explicit break.')], { pageBreak: true }),
      section([p('Continuous.')], { pageBreak: false }),
      section([p('Default, so break.')]),
    ]),
  },
  {
    // Childless sections: one bare, one whose only content is a header/footer.
    // The second takes the layout path for sections with no layout groups.
    name: 'structure/section-empty',
    document: doc([
      section([]),
      section([], {
        header: [p('Header on an empty section')],
        footer: [p('Footer on an empty section')],
      }),
      section([p('After the empty ones.')]),
    ]),
  },
  {
    // A section nested inside a section: the inner one flattens away, its
    // header/footer and page props never reach the writer.
    name: 'structure/section-nested',
    document: doc([
      section(
        [
          p('Outer before.'),
          section([p('Inner one.'), p('Inner two.')], {
            meta: { title: 'Inner' },
            pageBreak: false,
          }),
          p('Outer after.'),
        ],
        { meta: { title: 'Outer' } }
      ),
    ]),
  },
  {
    // enabled: false drops a whole section and, separately, a single child.
    name: 'structure/section-disabled',
    document: doc([
      section([p('Kept.')]),
      { ...(section([p('Dropped section.')]) as object), enabled: false },
      section([
        p('Kept child.'),
        {
          name: 'paragraph',
          enabled: false,
          props: { text: 'Dropped child.' },
        },
      ]),
    ]),
  },
  {
    // Section-level spacing: schema-valid, and currently not consulted by the
    // pipeline. Pinned so a migration that starts honouring it is visible.
    name: 'structure/section-spacing',
    document: doc([
      section([p('Spaced section.')], { spacing: { before: 18, after: 24 } }),
      section([p('Only before.')], { spacing: { before: 6 } }),
      section([p('Only after.')], { spacing: { after: 6 } }),
    ]),
  },

  // ---------------------------------------------------------------------------
  // Page setup
  // ---------------------------------------------------------------------------
  {
    // One section per named paper, so each w:pgSz carries its own paper code.
    name: 'structure/page-size-named',
    document: doc([
      section([p('A4.')], { page: { size: 'A4' } }),
      section([p('A3.')], { page: { size: 'A3' } }),
      section([p('Letter.')], { page: { size: 'LETTER' } }),
      section([p('Legal.')], { page: { size: 'LEGAL' } }),
    ]),
  },
  {
    // Custom {width, height} in twips: portrait, then landscape (width > height,
    // which is how this schema expresses orientation), then a square page.
    // A custom size deliberately carries no paper code.
    name: 'structure/page-size-custom',
    document: doc([
      section([p('Custom portrait.')], {
        page: { size: { width: 9000, height: 13000 } },
      }),
      section([p('Custom landscape.')], {
        page: { size: { width: 16838, height: 11906 } },
      }),
      section([p('Custom square.')], {
        page: { size: { width: 12240, height: 12240 } },
      }),
    ]),
  },
  {
    // Every margin slot set at once, including gutter and the header/footer
    // distances that position the running head and foot.
    name: 'structure/page-margins-full',
    document: doc([
      section([p('All margins.')], {
        page: {
          size: 'A4',
          margins: {
            top: 1800,
            bottom: 1600,
            left: 1500,
            right: 1300,
            header: 900,
            footer: 800,
            gutter: 720,
          },
        },
        header: [p('Head')],
        footer: [p('Foot')],
      }),
    ]),
  },
  {
    // Partial margin overrides merge onto the theme's margins rather than
    // replacing them; zero is a real value, not "unset".
    name: 'structure/page-margins-partial',
    document: doc([
      section([p('Top only.')], { page: { margins: { top: 2880 } } }),
      section([p('Left and right only.')], {
        page: { margins: { left: 2160, right: 2160 } },
      }),
      section([p('Zero margins.')], {
        page: {
          margins: { top: 0, bottom: 0, left: 0, right: 0, gutter: 0 },
        },
      }),
    ]),
  },
  {
    // Size-only, margins-only, both, and neither — the four ways a section can
    // override the theme page block, in one document.
    name: 'structure/page-override-per-section',
    document: doc(
      [
        section([p('Inherits the theme page.')]),
        section([p('Size only.')], { page: { size: 'LEGAL' } }),
        section([p('Margins only.')], {
          page: { margins: { left: 2000, right: 400 } },
        }),
        section([p('Both.')], {
          page: {
            size: { width: 15840, height: 12240 },
            margins: { top: 600, bottom: 600, header: 300, footer: 300 },
          },
        }),
        section([p('Empty page object.')], { page: {} }),
      ],
      { theme: 'vermilion' }
    ),
  },

  // ---------------------------------------------------------------------------
  // Headers and footers
  // ---------------------------------------------------------------------------
  {
    // The plain case: a default header and a default footer on one section.
    name: 'structure/header-and-footer',
    document: doc([
      section([p('Body.')], {
        header: [p('Running head')],
        footer: [p('Running foot')],
      }),
    ]),
  },
  {
    // Empty arrays: an explicit empty header/footer, which still emits a part so
    // Word's implicit link-to-previous is broken.
    name: 'structure/header-footer-empty',
    document: doc([
      section([p('One.')], { header: [p('Head')], footer: [p('Foot')] }),
      section([p('Two.')], { header: [], footer: [] }),
      section([p('Three.')], { header: [p('Head again')], footer: [] }),
    ]),
  },
  {
    // 'linkToPrevious' on both slots, and independently on one slot only.
    name: 'structure/header-footer-link-to-previous',
    document: doc([
      section([p('Defines both.')], {
        header: [p('Head A')],
        footer: [p('Foot A')],
      }),
      section([p('Links both.')], {
        header: 'linkToPrevious',
        footer: 'linkToPrevious',
      }),
      section([p('Links the header, replaces the footer.')], {
        header: 'linkToPrevious',
        footer: [p('Foot B')],
      }),
      section([p('Links back to the newest footer.')], {
        header: 'linkToPrevious',
        footer: 'linkToPrevious',
      }),
    ]),
  },
  {
    // Omitting header/footer after a section that had them is NOT linking: an
    // explicit empty part is written so nothing is inherited implicitly.
    name: 'structure/header-footer-implicit-reset',
    document: doc([
      section([p('Has a header and a footer.')], {
        header: [p('Head')],
        footer: [p('Foot')],
      }),
      section([p('Omits both.')]),
      section([p('Asks for the previous ones back.')], {
        header: 'linkToPrevious',
        footer: 'linkToPrevious',
      }),
    ]),
  },
  {
    // Header/footer paragraphs carry the full paragraph styling surface: they
    // resolve against the Normal style rather than a dedicated one.
    name: 'structure/header-footer-styled',
    document: doc([
      section([p('Body.')], {
        header: [
          p('Left', { alignment: 'left', font: { bold: true, size: 9 } }),
          p('Centre', {
            alignment: 'center',
            font: { italic: true, color: 'textSecondary', family: 'Georgia' },
            spacing: { before: 2, after: 4 },
          }),
          p('Right', {
            alignment: 'right',
            font: { underline: true, size: 8 },
          }),
        ],
        footer: [
          p('Justified footer line with **bold** decorators inside it.', {
            alignment: 'justify',
            boldColor: 'primary',
            font: { lineSpacing: { type: 'exactly', value: 12 } },
          }),
        ],
      }),
    ]),
  },
  {
    // Page numbering: the {PAGE} and {TOTAL_PAGES} fields, alone and mixed with
    // surrounding literal text, in both the header and the footer.
    name: 'structure/footer-page-numbers',
    document: doc([
      section([h('Numbered'), p(FILLER)], {
        header: [p('{PAGE}', { alignment: 'right' })],
        footer: [
          p('Page {PAGE} of {TOTAL_PAGES}', { alignment: 'center' }),
          p('{PAGE}/{TOTAL_PAGES}', { alignment: 'right', font: { size: 8 } }),
        ],
      }),
      section([p('Second section keeps the numbering.')], {
        header: 'linkToPrevious',
        footer: 'linkToPrevious',
      }),
    ]),
  },
  {
    // The date placeholders, made deterministic by pinning metadata.date, which
    // is what they read before falling back to the build timestamp.
    name: 'structure/header-footer-date-placeholders',
    document: doc(
      [
        section([p('Body.')], {
          header: [p('{DATE}', { alignment: 'left' })],
          footer: [p('{DATETIME} — {YEAR} — {UNKNOWN_PLACEHOLDER}')],
        }),
      ],
      { metadata: { title: 'Dated', date: '2021-06-07T08:09:10.000Z' } }
    ),
  },
  {
    // An inline base64 image in the header, sized against the content width.
    name: 'structure/header-image',
    document: doc([
      section([p('Body.')], {
        header: [
          { name: 'image', props: { base64: PNG_4X2, width: 96 } },
          p('Below the mark', { alignment: 'center' }),
        ],
        footer: [
          {
            name: 'image',
            props: {
              base64: PNG_4X2,
              width: '25%',
              alignment: 'right',
              widthRelativeTo: 'page',
            },
          },
        ],
      }),
    ]),
  },
  {
    // A table in the footer — headers and footers render tables through the same
    // primitive as the body.
    name: 'structure/footer-table',
    document: doc([
      section([p('Body.')], {
        header: [MINI_TABLE],
        footer: [MINI_TABLE, p('Page {PAGE}', { alignment: 'right' })],
      }),
    ]),
  },

  // ---------------------------------------------------------------------------
  // Columns
  // ---------------------------------------------------------------------------
  {
    // The shorthand count form: N equal columns, with the default 5% gap.
    name: 'structure/columns-count',
    document: doc([
      section([
        columns({ columns: 2 }, [p(FILLER), p(FILLER)]),
        columns({ columns: 3 }, [p(FILLER), p(FILLER), p(FILLER)]),
        columns({ columns: 4, gap: 10 }, [p(FILLER), p(FILLER)]),
      ]),
    ]),
  },
  {
    // A single column: the degenerate count, which should not produce a
    // multi-column section property.
    name: 'structure/columns-single',
    document: doc([
      section([
        columns({ columns: 1 }, [p(FILLER)]),
        columns({ columns: [{}] }, [p(FILLER)]),
      ]),
    ]),
  },
  {
    // Explicit widths and gaps in points, including a final column with no gap
    // after it. The totals are sized against the fallback theme's text measure
    // (A4 minus `minimal`'s margins), which layout.ts validates against — keep
    // them comfortably inside it.
    name: 'structure/columns-explicit-widths',
    document: doc([
      section([
        columns(
          {
            columns: [
              { width: 150, gap: 16 },
              { width: 110, gap: 16 },
              { width: 110 },
            ],
          },
          [p(FILLER), p(FILLER), p(FILLER)]
        ),
      ]),
    ]),
  },
  {
    // Percentage widths and gaps, resolved against the content width.
    name: 'structure/columns-percent-widths',
    document: doc([
      section([
        columns(
          {
            columns: [{ width: '60%', gap: '4%' }, { width: '36%' }],
          },
          [p(FILLER), p(FILLER)]
        ),
        columns(
          { columns: [{ width: '30%' }, { width: '30%' }, {}], gap: '2%' },
          [p(FILLER), p(FILLER), p(FILLER)]
        ),
      ]),
    ]),
  },
  {
    // 'auto' width: normalized to unspecified so the column takes the remainder
    // left after the fixed widths and gaps.
    name: 'structure/columns-auto-width',
    document: doc([
      section([
        columns({ columns: [{ width: 150, gap: 12 }, { width: 'auto' }] }, [
          p(FILLER),
          p(FILLER),
        ]),
        columns(
          {
            columns: [
              { width: 'auto', gap: '3%' },
              { width: '25%', gap: '3%' },
              { width: 'auto' },
            ],
          },
          [p(FILLER), p(FILLER), p(FILLER)]
        ),
      ]),
    ]),
  },
  {
    // Body prose, a columns block, then body prose again: one section splits
    // into three layout chunks, each with its own section properties. The
    // columnBreak forces flow to the next column inside the block.
    name: 'structure/columns-between-body',
    document: doc([
      section(
        [
          h('Intro'),
          p(FILLER),
          columns({ columns: 2, gap: 14 }, [
            p(FILLER),
            p(FILLER, { columnBreak: true }),
            p(FILLER),
          ]),
          h('Outro', 2),
          p(FILLER),
        ],
        {
          header: [p('Chunked section')],
          footer: [p('Page {PAGE}')],
          page: { size: 'A4', margins: { left: 900, right: 900 } },
        }
      ),
    ]),
  },
];
