/**
 * Headings and navigation.
 *
 * Everything that gives a document its outline: the six heading levels and the
 * props that decorate them, the multilevel heading numbering, the bookmarks a
 * heading or paragraph publishes, the two ways to point at one (`[text](#id)`
 * internal link and `[@id]` cross-reference), the table of contents — switches
 * and cached entries alike — and the page-number fields.
 *
 * Bookmark ids and cached TOC entries are computed by a pre-pass that has to
 * predict exactly what render emits, so several cases here deliberately push on
 * slug collisions, forward references and unresolvable targets: those are the
 * places where the two halves can drift apart without anything throwing.
 *
 * Two authorable features are missing because the current pipeline cannot
 * produce them byte-identically twice, and a hash corpus cannot hold a case
 * that changes on its own:
 *
 * - **External hyperlinks** (`[text](https://…)`, and `[text](#)` with an empty
 *   anchor, which falls through to the same code path). docx allocates their
 *   relationship id from a random `uniqueId()`, so `r:id="rId…"` differs on
 *   every render.
 * - **`text-box` followed by anything bookmarked.** A text-box's children
 *   allocate their bookmark `w:id`s outside the render's registry scope on the
 *   first render of a process and inside it on later ones, which shifts every
 *   id allocated after the box.
 *
 * Both should become corpus cases the moment those ids are made deterministic.
 */

import type { CorpusCase } from './corpus-types';

const doc = (
  children: unknown[],
  props: Record<string, unknown> = {}
): unknown => ({
  name: 'docx',
  props: { theme: 'minimal', ...props },
  children,
});

const heading = (
  text: string,
  props: Record<string, unknown> = {},
  id?: string
): unknown =>
  id === undefined
    ? { name: 'heading', props: { text, ...props } }
    : { name: 'heading', id, props: { text, ...props } };

const para = (text: string, props: Record<string, unknown> = {}): unknown => ({
  name: 'paragraph',
  props: { text, ...props },
});

const toc = (props: Record<string, unknown> = {}): unknown => ({
  name: 'toc',
  props,
});

/** A small outline several TOC cases point at, so only the switches vary. */
const OUTLINE: unknown[] = [
  heading('Chapter One', { level: 1 }),
  para('Opening remarks.'),
  heading('Background', { level: 2 }),
  para('Context.'),
  heading('Prior Work', { level: 3 }),
  para('References.'),
  heading('Fine Print', { level: 4 }),
  para('Detail.'),
  heading('Chapter Two', { level: 1 }),
  para('Closing remarks.'),
];

export const CASES: CorpusCase[] = [
  // --------------------------------------------------------------------------
  // Heading levels and props
  // --------------------------------------------------------------------------
  {
    // Every level the schema allows, each with body text after it so the
    // style's own spacing/keepNext is exercised rather than collapsing.
    name: 'headings/levels-all',
    document: doc([
      heading('Level One', { level: 1 }),
      para('After one.'),
      heading('Level Two', { level: 2 }),
      para('After two.'),
      heading('Level Three', { level: 3 }),
      para('After three.'),
      heading('Level Four', { level: 4 }),
      para('After four.'),
      heading('Level Five', { level: 5 }),
      para('After five.'),
      heading('Level Six', { level: 6 }),
      para('After six.'),
    ]),
  },
  {
    // No `level` at all falls back to 1; an empty and a whitespace-only heading
    // slug to nothing, which is the degenerate input for the bookmark id
    // generator (and for a cached TOC entry title).
    name: 'headings/level-default-and-empty-text',
    document: doc([
      heading('No Level Given'),
      heading('', { level: 2 }),
      heading('   ', { level: 2 }),
      heading('Back To Normal', { level: 2 }),
    ]),
  },
  {
    // Inline decorators are consumed by the heading run builder, and stripped
    // again — separately — when the outline pre-pass computes the entry title.
    name: 'headings/decorators-in-text',
    document: doc([
      toc({ title: 'Contents' }),
      heading('**Bold** heading', { level: 1 }),
      heading('*Italic* heading', { level: 2 }),
      heading('***Both*** at once', { level: 2 }),
      heading('__Underscored__ and _mixed_', { level: 3 }),
      heading('Not*a*decorator? yes it is', { level: 3 }),
    ]),
  },
  {
    // Local font overrides on a heading are partial by design: none of these
    // name a family except the last, and each one has to survive the merge with
    // the theme's own heading style.
    name: 'headings/font-override',
    document: doc([
      heading('Recoloured', { level: 1, font: { color: '#B22222' } }),
      heading('Resized', { level: 1, font: { size: 30 } }),
      heading('Bold Italic Underline', {
        level: 2,
        font: { bold: true, italic: true, underline: true },
      }),
      heading('Weighted', { level: 2, font: { fontWeight: 300 } }),
      heading('Tracked And Scaled', {
        level: 3,
        font: {
          scale: 115,
          characterSpacing: { type: 'expanded', value: 1.5 },
        },
      }),
      heading('Condensed Georgia', {
        level: 3,
        font: {
          family: 'Georgia',
          size: 18,
          characterSpacing: { type: 'condensed', value: 0.6 },
        },
      }),
      heading('Theme Colour Token', { level: 4, font: { color: 'primary' } }),
    ]),
  },
  {
    // Paragraph-shaped props: the four alignments, spacing in points, the two
    // indent modes (they are mutually exclusive), and line spacing in both of
    // the shapes the schema accepts — a bare multiplier and the object form.
    name: 'headings/paragraph-properties',
    document: doc([
      heading('Left', { level: 2, alignment: 'left' }),
      heading('Centered', { level: 2, alignment: 'center' }),
      heading('Right', { level: 2, alignment: 'right' }),
      heading(
        'Justified Heading Text That Is Long Enough To Wrap Across Lines',
        {
          level: 2,
          alignment: 'justify',
        }
      ),
      heading('Spaced', { level: 3, spacing: { before: 24, after: 18 } }),
      heading('No Space', { level: 3, spacing: { before: 0, after: 0 } }),
      heading('Indented Both Sides', {
        level: 3,
        indent: { left: 720, right: 360 },
      }),
      heading('First Line Indent', { level: 3, indent: { firstLine: 480 } }),
      heading('Hanging Indent', {
        level: 3,
        indent: { left: 720, hanging: 360 },
      }),
      heading('Numeric Line Spacing', { level: 4, lineSpacing: 1.5 }),
      heading('Exact Line Spacing', {
        level: 4,
        lineSpacing: { type: 'exactly', value: 22 },
      }),
      heading('Double Line Spacing', {
        level: 4,
        lineSpacing: { type: 'double' },
      }),
    ]),
  },
  {
    // Pagination props, including the two break kinds. A column break outside a
    // multi-column section is legal input and still writes the break run.
    name: 'headings/pagination-breaks',
    document: doc([
      heading('First Page', { level: 1 }),
      para('Body.'),
      heading('Forced Onto A New Page', { level: 1, pageBreak: true }),
      para('Body.'),
      heading('Column Break Before', { level: 2, columnBreak: true }),
      para('Body.'),
      heading('Kept With Next', { level: 2, keepNext: true }),
      para('Body.'),
      heading('Lines Kept Together, Which Matters Once The Heading Wraps', {
        level: 2,
        keepLines: true,
      }),
      heading('Both Kept, No Break', {
        level: 3,
        keepNext: true,
        keepLines: true,
        pageBreak: false,
        columnBreak: false,
      }),
    ]),
  },
  {
    // Proofing overrides ride on the heading's runs: a per-heading language, a
    // whole heading excluded from spell-check, and the known-words allowlist,
    // which splits one heading into several runs.
    name: 'headings/proofing',
    document: doc(
      [
        heading('Résumé du Chapitre', { level: 1, language: 'fr-FR' }),
        heading('kubectl apply -f deploy.yaml', { level: 2, noProof: true }),
        heading('Wiseair and json-to-office together', {
          level: 2,
          noProofWords: ['Wiseair', 'json-to-office'],
        }),
        heading('Plain again', { level: 3 }),
      ],
      { language: 'en-US', noProofWords: ['docx'] }
    ),
  },

  // --------------------------------------------------------------------------
  // Heading numbering
  // --------------------------------------------------------------------------
  {
    // The shared multilevel definition, registered lazily on the first numbered
    // heading. Nested levels should read 1., 1.1., 1.1.1., then restart.
    name: 'headings/numbering-nested-levels',
    document: doc([
      heading('Scope', { level: 1, numbering: true }),
      heading('Inputs', { level: 2, numbering: true }),
      heading('Sources', { level: 3, numbering: true }),
      heading('Outputs', { level: 2, numbering: true }),
      heading('Method', { level: 1, numbering: true }),
      heading('Sampling', { level: 2, numbering: true }),
      heading('Deep', { level: 4, numbering: true }),
      heading('Deeper', { level: 5, numbering: true }),
      heading('Deepest', { level: 6, numbering: true }),
    ]),
  },
  {
    // Numbering turned on document-wide by componentDefaults, with one heading
    // opting out — docx writes that as numId 0, not as an absent w:numPr.
    name: 'headings/numbering-document-default-and-optout',
    document: doc(
      [
        heading('Numbered By Default', { level: 1 }),
        heading('Also Numbered', { level: 2 }),
        heading('Explicitly Not Numbered', { level: 2, numbering: false }),
        heading('Numbered Again', { level: 2 }),
        heading('Back To Level One', { level: 1 }),
      ],
      { componentDefaults: { heading: { numbering: true } } }
    ),
  },
  {
    // Levels skipped and revisited out of order: the counters for the levels in
    // between are still allocated, so the numbers a reader sees depend on the
    // whole sequence, not on each heading alone.
    name: 'headings/numbering-level-gaps',
    document: doc([
      heading('One', { level: 1, numbering: true }),
      heading('Straight To Three', { level: 3, numbering: true }),
      heading('Back To Two', { level: 2, numbering: true }),
      heading('Unnumbered In The Middle', { level: 2 }),
      heading('Three Again', { level: 3, numbering: true }),
      heading('Another One', { level: 1, numbering: true }),
    ]),
  },

  // --------------------------------------------------------------------------
  // Bookmarks
  // --------------------------------------------------------------------------
  {
    // Auto-generated ids: the slug lowercases, hyphenates whitespace, drops
    // everything outside [a-z0-9-] and truncates at 40 characters. Each link
    // below targets the slug the generator should produce.
    name: 'headings/bookmark-auto-slug',
    document: doc([
      heading('Data Sources', { level: 1 }),
      heading('Costs & Benefits (2024)', { level: 2 }),
      heading('Résumé — Übersicht', { level: 2 }),
      heading(
        'A Heading Whose Text Is Comfortably Longer Than Forty Characters',
        {
          level: 2,
        }
      ),
      heading('  Padded   And   Spaced  ', { level: 2 }),
      para('Jump to [Data Sources](#data-sources).'),
      para('Jump to [Costs](#costs--benefits-2024).'),
      para('Jump to [Résumé](#rsum--bersicht).'),
      para('Jump to [the long one](#a-heading-whose-text-is-comfortably-l).'),
      para('Jump to [the padded one](#-padded---and---spaced-).'),
    ]),
  },
  {
    // Collisions, from three directions: two headings with the same text, and a
    // paragraph that claims the slug a heading would otherwise take. The
    // dedupe suffix has to be predicted identically by the outline pre-pass and
    // by render, or a link points at a bookmark nobody wrote.
    name: 'headings/bookmark-slug-collisions',
    document: doc([
      para('Summary paragraph.', { id: 'results' }),
      heading('Results', { level: 1 }),
      heading('Results', { level: 2 }),
      heading('Results', { level: 2 }),
      para('Paragraph anchor: [first](#results).'),
      para('First heading: [second](#results-1).'),
      para('Second heading: [third](#results-2).'),
      para('Third heading: [fourth](#results-3).'),
    ]),
  },
  {
    // An explicit component-level id replaces the generated slug entirely, so
    // the heading's own text no longer names it.
    name: 'headings/bookmark-explicit-id',
    document: doc([
      heading('Executive Summary', { level: 1 }, 'exec'),
      heading('Appendix A', { level: 1 }, 'appendix.a'),
      heading('Ünicode Title', { level: 2 }, 'unicode-id'),
      para('See [the summary](#exec) and [appendix A](#appendix.a).'),
      para('And [the unicode one](#unicode-id).'),
      para(
        'The slug it would have had is now unused: [dangling](#executive-summary).'
      ),
    ]),
  },
  {
    // Bookmarks published by paragraphs rather than headings, linked both
    // backwards and forwards.
    name: 'headings/internal-link-paragraph-anchor',
    document: doc([
      heading('Terms', { level: 1 }),
      para('A definition worth pointing at.', { id: 'definition' }),
      para(
        'Forward to [the note](#trailing-note), back to [the definition](#definition).'
      ),
      para('A trailing note.', { id: 'trailing-note' }),
    ]),
  },
  {
    // Links whose target does not exist. Word writes the hyperlink anyway and
    // resolves nothing on click; generation must not throw or drop the run.
    //
    // `[x](#)` — an internal link with an empty anchor — is deliberately absent:
    // docx falls back to a relationship id built from a random `uniqueId()`
    // when the anchor is falsy, so that one input alone makes the package
    // differ on every render.
    name: 'headings/internal-link-dangling',
    document: doc([
      heading('Only Heading', { level: 1 }),
      para('Missing target: [nowhere](#no-such-bookmark).'),
      para('Case differs from the slug: [Only Heading](#Only-Heading).'),
      para('Anchor that is only punctuation: [odd](#--).'),
    ]),
  },
  {
    // Bracket syntax pushed on from both sides: tokens flush against each
    // other, brackets that are not links at all, and an unclosed one.
    //
    // External `[text](https://…)` links are deliberately absent from the whole
    // corpus: docx allocates their relationship id from a random `uniqueId()`,
    // so a document containing one is not byte-stable.
    name: 'headings/links-mixed-inline',
    document: doc([
      heading('Mixed Inline', { level: 1 }),
      heading('Second Target', { level: 2 }),
      para(
        'A section [above](#mixed-inline), **[another](#second-target)**, and *emphasis* in between.'
      ),
      para('[One](#mixed-inline)[Two](#second-target)[Three](#mixed-inline)'),
      para('Brackets that are not links: [not a link] and (not a url).'),
      para(
        'An unclosed bracket [dangling and then some prose that keeps going.'
      ),
      para(
        'A cross-reference and a link together: [@second-target:none] at [Second Target](#second-target).'
      ),
    ]),
  },
  {
    // Link tokens outside a plain paragraph: inside a heading (whose simple-run
    // builder has to bail out to the full inline parser) and inside list items.
    name: 'headings/internal-link-in-heading-and-list',
    document: doc([
      heading('Anchor Point', { level: 1 }),
      heading('Back to [Anchor Point](#anchor-point)', { level: 2 }),
      {
        name: 'list',
        props: {
          format: 'bullet',
          items: [
            'See [Anchor Point](#anchor-point)',
            { text: 'And [again](#anchor-point)', level: 1 },
            'Plain item',
          ],
        },
      },
    ]),
  },

  // --------------------------------------------------------------------------
  // Cross-references
  // --------------------------------------------------------------------------
  {
    // All four REF formats against the same numbered heading, plus the default
    // (no suffix, which means relative). Each carries a cached value so the
    // headless-LibreOffice path shows something.
    name: 'headings/cross-reference-formats',
    document: doc([
      heading('Approach', { level: 1, numbering: true }),
      heading('Methods', { level: 2, numbering: true }, 'methods'),
      heading('Measurements', { level: 3, numbering: true }, 'measurements'),
      para('Default: [@methods].'),
      para('Relative: [@methods:relative].'),
      para('No context: [@methods:no_context].'),
      para('Full context: [@methods:full_context].'),
      para('Text only: [@methods:none].'),
      para(
        'Deeper target: [@measurements:full_context] and [@measurements:none].'
      ),
      heading('Recap of [@methods]', { level: 2 }),
    ]),
  },
  {
    // The awkward corners: a forward reference resolved by the pre-pass, a
    // reference to an unnumbered heading (cached value is blank), and an id
    // nothing declares (rendered as its literal token text, not a broken REF).
    name: 'headings/cross-reference-unresolved',
    document: doc([
      para('Forward: [@later].'),
      para('Unnumbered target: [@plain] and [@plain:none].'),
      para('No such target: [@nobody] and [@nobody:full_context].'),
      heading('Plain Heading', { level: 1 }, 'plain'),
      heading('Later Heading', { level: 1, numbering: true }, 'later'),
    ]),
  },
  {
    // List items are the other cross-reference target kind, and the only one
    // whose id lives on the item rather than on the component.
    name: 'headings/cross-reference-list-item',
    document: doc([
      heading('Clauses', { level: 1, numbering: true }, 'clauses'),
      {
        name: 'list',
        props: {
          format: 'numbered',
          items: [
            'First clause',
            { text: 'Second clause', id: 'clause-two' },
            { text: 'Nested clause', level: 1, id: 'clause-two-a' },
            'Third clause',
          ],
        },
      },
      para('Per [@clause-two] and [@clause-two-a:full_context].'),
      para('By text: [@clause-two:none], under [@clauses].'),
      para('And a link straight to it: [the clause](#clause-two).'),
    ]),
  },

  // --------------------------------------------------------------------------
  // Table of contents
  // --------------------------------------------------------------------------
  {
    // Every prop defaulted: depth 1-3, page numbers on, tab separator, auto
    // scope, no title.
    name: 'headings/toc-default',
    document: doc([toc(), ...OUTLINE]),
  },
  {
    // The `\o` outline range, including the one-sided forms the schema allows
    // and a range that collapses to a single level.
    name: 'headings/toc-depth-ranges',
    document: doc([
      toc({ title: 'Full depth', depth: { from: 1, to: 6 } }),
      toc({ title: 'From only', depth: { from: 2 } }),
      toc({ title: 'To only', depth: { to: 2 } }),
      toc({ title: 'Single level', depth: { from: 2, to: 2 } }),
      toc({ title: 'Empty depth object', depth: {} }),
      ...OUTLINE,
    ]),
  },
  {
    // Page numbers: suppressed entirely, kept but separated by a space instead
    // of a tab, and shown only for part of the outline range.
    name: 'headings/toc-page-numbers',
    document: doc([
      toc({ title: 'No page numbers', includePageNumbers: false }),
      toc({ title: 'Space separator', numberSeparator: false }),
      toc({
        title: 'Numbers on levels 1-2 only',
        depth: { from: 1, to: 4 },
        pageNumbersDepth: { from: 1, to: 2 },
      }),
      toc({
        title: 'Numbers off, separator off',
        includePageNumbers: false,
        numberSeparator: false,
      }),
      ...OUTLINE,
    ]),
  },
  {
    // A TOC that starts its own page, and one that does not, so the pageBreak
    // switch is pinned in both positions.
    name: 'headings/toc-title-and-page-break',
    document: doc([
      heading('Cover', { level: 1 }),
      para('Front matter.'),
      toc({ title: 'Table of Contents', pageBreak: true }),
      toc({ title: '', pageBreak: false }),
      ...OUTLINE,
    ]),
  },
  {
    // Scope: a section-scoped TOC writes a `\b` bookmark switch and its cached
    // entries stop at the section boundary; a document-scoped one inside a
    // section does not; `auto` picks section because it sits in one.
    name: 'headings/toc-scope-sections',
    document: doc([
      {
        name: 'section',
        props: { meta: { title: 'Part One' } },
        children: [
          toc({ title: 'This part only', scope: 'section' }),
          toc({ title: 'Whole document', scope: 'document' }),
          toc({ title: 'Auto inside a section', scope: 'auto' }),
          heading('Part One', { level: 1 }),
          heading('One A', { level: 2 }),
          heading('One B', { level: 2 }),
        ],
      },
      {
        name: 'section',
        props: { meta: { title: 'Part Two' }, pageBreak: true },
        children: [
          toc({ title: 'Part two only', scope: 'section' }),
          heading('Part Two', { level: 1 }),
          heading('Two A', { level: 2 }),
        ],
      },
    ]),
  },
  {
    // The `\t` switch: paragraphs carrying a custom themeStyle become entries
    // at the level the mapping gives them. A mapping may name the theme key or
    // the Word display name, and both have to collect the same paragraphs.
    name: 'headings/toc-style-mapping',
    document: doc(
      [
        toc({
          title: 'By theme key',
          styles: [
            { styleId: 'calloutTitle', level: 2 },
            { styleId: 'sidebarLabel', level: 3 },
          ],
        }),
        toc({
          title: 'By display name',
          styles: [{ styleId: 'callout Title', level: 1 }],
        }),
        heading('Real Heading', { level: 1 }),
        para('A callout title', { themeStyle: 'calloutTitle' }),
        para('A sidebar label', { themeStyle: 'sidebarLabel' }),
        para('Ordinary body text.'),
        para('Styled but unmapped', { themeStyle: 'unmappedStyle' }),
      ],
      {
        themeOverrides: {
          styles: {
            calloutTitle: { size: 14, bold: true },
            sidebarLabel: { size: 12, italic: true },
            unmappedStyle: { size: 11 },
          },
        },
      }
    ),
  },
  {
    // `numberingStyle` is accepted for back-compat and deliberately not applied
    // — Word's TOC field carries no numbering switch. Pinning it keeps the
    // "does nothing" contract honest, warning included.
    name: 'headings/toc-numbering-style-legacy',
    document: doc([
      toc({ title: 'Numeric', numberingStyle: 'numeric' }),
      toc({ title: 'Bullet', numberingStyle: 'bullet' }),
      toc({ title: 'None', numberingStyle: 'none' }),
      ...OUTLINE,
    ]),
  },
  {
    // Numbered headings feed their number into the cached entries, in the same
    // form Word's own refresh produces — trailing period included.
    name: 'headings/toc-cached-numbered-entries',
    document: doc([
      toc({ title: 'Contents', depth: { from: 1, to: 4 } }),
      heading('Introduction', { level: 1, numbering: true }),
      heading('Purpose', { level: 2, numbering: true }),
      heading('Audience', { level: 2, numbering: true }),
      heading('Not Numbered', { level: 2 }),
      heading('Method', { level: 1, numbering: true }),
      heading('Sampling', { level: 2, numbering: true }),
      heading('Instruments', { level: 3, numbering: true }),
      heading('Calibration', { level: 4, numbering: true }),
    ]),
  },
  {
    // Headings the outline walk has to descend into a container to find. A
    // text-box renders its children as real heading paragraphs, so Word's `\o`
    // switch collects them and the cached entries must agree.
    //
    // The text-box comes last on purpose. Its children's bookmark `w:id`s are
    // allocated outside the render's registry scope on the first render of a
    // process and inside it afterwards, so anything bookmarked *after* a
    // text-box numbers differently on run one than on run two — which no hash
    // can survive. Keeping it last leaves nothing behind it to renumber.
    name: 'headings/toc-in-nested-container',
    document: doc([
      toc({ title: 'Contents', depth: { from: 1, to: 3 } }),
      heading('Top Level', { level: 1 }),
      heading('Before The Container', { level: 2 }),
      {
        name: 'text-box',
        props: { width: 320, height: 120 },
        children: [
          heading('Boxed Title', { level: 2 }),
          para('Inside the box.'),
          heading('Boxed Subtitle', { level: 3 }),
        ],
      },
    ]),
  },
  {
    // The same descent, one container over: `columns` children are hoisted by
    // the layout pass before the outline walk runs, so their headings still
    // have to reach the TOC.
    name: 'headings/toc-in-columns',
    document: doc([
      toc({ title: 'Contents', depth: { from: 1, to: 3 } }),
      heading('Top Level', { level: 1 }),
      {
        name: 'columns',
        props: { columns: 2 },
        children: [
          heading('Left Column Heading', { level: 2 }),
          para('Left body.'),
          heading('Right Column Heading', { level: 2 }),
          para('Right body.'),
        ],
      },
      heading('After The Columns', { level: 2 }),
    ]),
  },

  // --------------------------------------------------------------------------
  // Page-number fields
  // --------------------------------------------------------------------------
  {
    // PAGE and NUMPAGES fields, in a header, in a footer, and in body text —
    // the last is legal and renders the same field run.
    name: 'headings/fields-page-numbers',
    document: doc([
      {
        name: 'section',
        props: {
          header: [para('Handbook — page {PAGE}', { alignment: 'right' })],
          footer: [
            para('Page {PAGE} of {TOTAL_PAGES}', { alignment: 'center' }),
          ],
        },
        children: [
          heading('Handbook', { level: 1 }),
          para('This is page {PAGE} of {TOTAL_PAGES}.'),
          para('{PAGE}'),
          para('Styled field: **{PAGE}** of *{TOTAL_PAGES}*.'),
        ],
      },
    ]),
  },
  {
    // Per-section headers and footers, then a section that inherits both. The
    // page-number fields keep counting across the boundary either way.
    name: 'headings/header-footer-link-to-previous',
    document: doc([
      {
        name: 'section',
        props: {
          meta: { title: 'Front' },
          header: [para('Front matter', { alignment: 'left' })],
          footer: [para('{PAGE}', { alignment: 'center' })],
        },
        children: [heading('Front Matter', { level: 1 }), para('Body.')],
      },
      {
        name: 'section',
        props: {
          meta: { title: 'Main' },
          pageBreak: true,
          header: [
            para('Main body — {PAGE}/{TOTAL_PAGES}', { alignment: 'right' }),
          ],
          footer: [para('Confidential', { alignment: 'left' })],
        },
        children: [heading('Main Body', { level: 1 }), para('Body.')],
      },
      {
        name: 'section',
        props: {
          meta: { title: 'Back' },
          pageBreak: true,
          header: 'linkToPrevious',
          footer: 'linkToPrevious',
        },
        children: [heading('Back Matter', { level: 1 }), para('Body.')],
      },
    ]),
  },
];
