/**
 * The `list` slice of the DOCX parity corpus.
 *
 * Lists are the one component whose output is split across two parts of the
 * package: the paragraphs in `document.xml` and the abstract numbering in
 * `numbering.xml`. Almost every prop here moves the second one, which no
 * amount of reading the body text would reveal — so the cases below walk the
 * numbering surface deliberately: the simplified shorthand, explicit `levels`,
 * the level defaults that get synthesised for depths nobody declared, and the
 * per-level knobs (format, text template, alignment, indent, start, marker
 * font) that only exist inside `w:lvl`.
 *
 * Every document is deterministic — no clocks, no randomness, no network, no
 * local paths — because a case is identified by the SHA-256 of the package it
 * produces.
 */

import type { CorpusCase } from './corpus-types';

/** A `docx` root with fixed metadata, so only the list varies between cases. */
const doc = (children: unknown[], props: Record<string, unknown> = {}) => ({
  name: 'docx',
  props: { theme: 'minimal', metadata: { title: 'Corpus' }, ...props },
  children,
});

/** A `list` component. */
const list = (props: Record<string, unknown>) => ({ name: 'list', props });

/** A document whose only content is one list. */
const listDoc = (props: Record<string, unknown>) => doc([list(props)]);

/** Three plain items, reused wherever the item text is not the point. */
const ITEMS = ['Alpha', 'Beta', 'Gamma'];

export const CASES: CorpusCase[] = [
  // --------------------------------------------------------------------
  // The simplified shorthand: no `levels`, everything derived from format,
  // bullet, start and indent.
  // --------------------------------------------------------------------
  {
    // The bare minimum: no props but `items`. Level 0 falls back to a bullet
    // list with the '•' glyph and two synthesised sublevels.
    name: 'lists/bulleted-default',
    document: listDoc({ items: ITEMS }),
  },
  {
    // Exactly one item — the smallest list the schema allows (minItems: 1).
    name: 'lists/single-item',
    document: listDoc({ items: ['Only'] }),
  },
  {
    // `bullet` replaces the level-0 glyph; the synthesised sublevels keep
    // their own defaults, so this also pins that they are unaffected.
    name: 'lists/bullet-custom-character',
    document: listDoc({
      items: [
        { text: 'Arrow root' },
        { text: 'Untouched sublevel', level: 1 },
        { text: 'And deeper', level: 2 },
      ],
      bullet: '→',
    }),
  },
  {
    // `format: 'numbered'` is the alias for decimal + the '%1.' template.
    name: 'lists/numbered-simplified',
    document: listDoc({ items: ITEMS, format: 'numbered' }),
  },
  {
    // `format: 'none'` asks for no marker. The level text is set to '' by the
    // shorthand, which the numbering builder treats as absent and replaces
    // with '%1.' — the marker format is NONE, so nothing renders, but the
    // template still lands in the XML. An awkward corner worth pinning.
    name: 'lists/format-none',
    document: listDoc({ items: ITEMS, format: 'none' }),
  },
  {
    // `start` on the shorthand path: level 0 counts from 5.
    name: 'lists/simplified-start',
    document: listDoc({ items: ITEMS, format: 'numbered', start: 5 }),
  },
  {
    // The five Latin-script formats an English document actually uses, one
    // list each, so a change to any single mapping names itself.
    name: 'lists/formats-latin',
    document: doc([
      list({ items: ['decimal one', 'decimal two'], format: 'decimal' }),
      list({
        items: ['upper roman one', 'upper roman two'],
        format: 'upperRoman',
      }),
      list({
        items: ['lower roman one', 'lower roman two'],
        format: 'lowerRoman',
      }),
      list({
        items: ['upper letter one', 'upper letter two'],
        format: 'upperLetter',
      }),
      list({
        items: ['lower letter one', 'lower letter two'],
        format: 'lowerLetter',
      }),
    ]),
  },
  {
    // A sweep through the non-Latin and word-form level formats: these are a
    // pure lookup table, and a table entry that quietly moves would otherwise
    // only show up in a reader.
    name: 'lists/formats-exotic',
    document: doc(
      [
        'ordinal',
        'cardinalText',
        'ordinalText',
        'hex',
        'chicago',
        'decimalZero',
        'numberInDash',
        'decimalEnclosedCircle',
        'decimalEnclosedParen',
        'japaneseCounting',
        'aiueo',
        'iroha',
        'chineseCounting',
        'koreanCounting',
        'vietnameseCounting',
        'russianLower',
        'russianUpper',
        'hebrew1',
        'hebrew2',
        'arabicAlpha',
        'arabicAbjad',
        'hindiNumbers',
        'thaiNumbers',
        'ganada',
        'chosung',
      ].map((format) =>
        list({ items: [`${format} one`, `${format} two`], format })
      )
    ),
  },

  // --------------------------------------------------------------------
  // Nesting.
  // --------------------------------------------------------------------
  {
    // Bullet nesting through the three glyphs the shorthand declares.
    name: 'lists/nested-bullets-three-levels',
    document: listDoc({
      items: [
        'Root',
        { text: 'Child', level: 1 },
        { text: 'Grandchild', level: 2 },
        { text: 'Back to child', level: 1 },
        { text: 'Back to root', level: 0 },
      ],
    }),
  },
  {
    // Numbered nesting: the shorthand hands sublevels decimal -> lowerLetter
    // -> lowerRoman, and each has to restart under its parent.
    name: 'lists/nested-numbered-defaults',
    document: listDoc({
      items: [
        'One',
        { text: 'One a', level: 1 },
        { text: 'One a i', level: 2 },
        { text: 'One a ii', level: 2 },
        { text: 'One b', level: 1 },
        { text: 'Two', level: 0 },
        { text: 'Two a', level: 1 },
      ],
      format: 'numbered',
    }),
  },
  {
    // Level 8 is the deepest the schema allows. Levels 3..8 are synthesised
    // by the fill pass, which cycles a five-glyph bullet palette — so this
    // pins the wrap-around too.
    name: 'lists/nested-max-depth',
    document: listDoc({
      items: [
        { text: 'L0', level: 0 },
        { text: 'L1', level: 1 },
        { text: 'L2', level: 2 },
        { text: 'L3', level: 3 },
        { text: 'L4', level: 4 },
        { text: 'L5', level: 5 },
        { text: 'L6', level: 6 },
        { text: 'L7', level: 7 },
        { text: 'L8', level: 8 },
      ],
    }),
  },
  {
    // Deep nesting under a numbered root: the fill pass cycles
    // decimal/lowerLetter/lowerRoman rather than the bullet palette.
    name: 'lists/nested-numbered-max-depth',
    document: listDoc({
      items: [
        { text: 'N0', level: 0 },
        { text: 'N1', level: 1 },
        { text: 'N2', level: 2 },
        { text: 'N3', level: 3 },
        { text: 'N4', level: 4 },
        { text: 'N5', level: 5 },
        { text: 'N6', level: 6 },
        { text: 'N7', level: 7 },
        { text: 'N8', level: 8 },
      ],
      format: 'numbered',
    }),
  },
  {
    // Levels the author skips on the way down, and a first item that starts
    // mid-tree. Word has to invent the intermediate context.
    name: 'lists/nested-level-jumps',
    document: listDoc({
      items: [
        { text: 'Starts at two', level: 2 },
        { text: 'Jumps to zero', level: 0 },
        { text: 'Straight to three', level: 3 },
        { text: 'Up to one', level: 1 },
        { text: 'Down to zero', level: 0 },
      ],
      format: 'numbered',
    }),
  },
  {
    // A bullet root with numbered children: `format` describes level 0 only,
    // so the mixed shape has to come from explicit levels.
    name: 'lists/mixed-bullet-and-numbered-levels',
    document: listDoc({
      items: [
        'Bulleted root',
        { text: 'Numbered child', level: 1 },
        { text: 'Another numbered child', level: 1 },
        { text: 'Lettered grandchild', level: 2 },
        { text: 'Second bulleted root', level: 0 },
        { text: 'Numbered again', level: 1 },
      ],
      levels: [
        { level: 0, format: 'bullet', text: '•' },
        { level: 1, format: 'decimal', text: '%2.' },
        { level: 2, format: 'upperLetter', text: '%3)' },
      ],
    }),
  },

  // --------------------------------------------------------------------
  // Explicit `levels`.
  // --------------------------------------------------------------------
  {
    // Every per-level field the schema exposes, on one level each.
    name: 'lists/levels-explicit',
    document: listDoc({
      items: [
        'First',
        { text: 'Nested first', level: 1 },
        { text: 'Nested second', level: 1 },
        { text: 'Second', level: 0 },
      ],
      levels: [
        {
          level: 0,
          format: 'decimal',
          text: '%1.',
          alignment: 'left',
          indent: { left: 36, hanging: 18 },
          start: 2,
        },
        {
          level: 1,
          format: 'lowerLetter',
          text: '%2)',
          alignment: 'right',
          indent: { left: 72, hanging: 24 },
          start: 3,
        },
      ],
    }),
  },
  {
    // `levels` declares 0 and 2 but the items reach 3: level 1 and level 3
    // are synthesised from level 0's format, not from their neighbours.
    name: 'lists/levels-partial-filled',
    document: listDoc({
      items: [
        'Declared root',
        { text: 'Gap level', level: 1 },
        { text: 'Declared level two', level: 2 },
        { text: 'Filled level three', level: 3 },
      ],
      levels: [
        { level: 0, format: 'decimal', text: '%1.' },
        { level: 2, format: 'upperRoman', text: '%3.' },
      ],
    }),
  },
  {
    // A level's own `start` is more specific than the list's, so level 0
    // counts from 7 and not from 4; level 1 has no `start` of its own and is
    // left alone because `props.start` only folds into level 0.
    name: 'lists/level-start-overrides',
    document: listDoc({
      items: ['One', { text: 'One a', level: 1 }, 'Two'],
      start: 4,
      levels: [
        { level: 0, format: 'decimal', text: '%1.', start: 7 },
        { level: 1, format: 'lowerLetter', text: '%2.' },
      ],
    }),
  },
  {
    // The mirror of the above: `props.start` with explicit levels and no
    // level-local start, which is the case that used to be dropped.
    name: 'lists/start-with-explicit-levels',
    document: listDoc({
      items: ITEMS,
      start: 12,
      levels: [{ level: 0, format: 'decimal', text: '%1.' }],
    }),
  },
  {
    // Number-format templates: separators, wrapping punctuation, multi-level
    // composites and literal text around the counter.
    name: 'lists/level-text-templates',
    document: listDoc({
      items: [
        'Composite root',
        { text: 'Composite child', level: 1 },
        { text: 'Composite grandchild', level: 2 },
        { text: 'Second root', level: 0 },
        { text: 'Second child', level: 1 },
      ],
      levels: [
        { level: 0, format: 'decimal', text: 'Step %1 —' },
        { level: 1, format: 'decimal', text: '%1.%2' },
        { level: 2, format: 'lowerRoman', text: '(%3)' },
      ],
    }),
  },
  {
    // Marker alignment: every member of the union, one per level.
    name: 'lists/level-marker-alignment',
    document: listDoc({
      items: [
        { text: 'Start-aligned', level: 0 },
        { text: 'End-aligned', level: 1 },
        { text: 'Left-aligned', level: 2 },
        { text: 'Right-aligned', level: 3 },
        { text: 'Centre-aligned', level: 4 },
      ],
      levels: [
        { level: 0, format: 'decimal', text: '%1.', alignment: 'start' },
        { level: 1, format: 'decimal', text: '%2.', alignment: 'end' },
        { level: 2, format: 'decimal', text: '%3.', alignment: 'left' },
        { level: 3, format: 'decimal', text: '%4.', alignment: 'right' },
        { level: 4, format: 'decimal', text: '%5.', alignment: 'center' },
      ],
    }),
  },
  {
    // Per-level indent in points: a level with both fields, one with only
    // `left`, one with only `hanging`, one with neither (which keeps the
    // half-inch-per-depth default) and one at zero — the minimum the schema
    // allows, and the value most easily confused with "absent".
    name: 'lists/level-indent',
    document: listDoc({
      items: [
        { text: 'Both', level: 0 },
        { text: 'Left only', level: 1 },
        { text: 'Hanging only', level: 2 },
        { text: 'Neither', level: 3 },
        { text: 'Zero', level: 4 },
      ],
      levels: [
        {
          level: 0,
          format: 'bullet',
          text: '•',
          indent: { left: 18, hanging: 9 },
        },
        { level: 1, format: 'bullet', text: '◦', indent: { left: 54 } },
        { level: 2, format: 'bullet', text: '▪', indent: { hanging: 36 } },
        { level: 3, format: 'bullet', text: '▫' },
        {
          level: 4,
          format: 'bullet',
          text: '‣',
          indent: { left: 0, hanging: 0 },
        },
      ],
    }),
  },

  // --------------------------------------------------------------------
  // Marker font — styles the glyph, never the item text.
  // --------------------------------------------------------------------
  {
    // Every marker-font field at once, on a numbered level.
    name: 'lists/marker-font',
    document: listDoc({
      items: ITEMS,
      levels: [
        {
          level: 0,
          format: 'decimal',
          text: '%1.',
          font: {
            family: 'Georgia',
            size: 14,
            color: '#E6620C',
            bold: true,
            italic: true,
            underline: true,
          },
        },
      ],
    }),
  },
  {
    // A theme token instead of a hex colour, resolved at render time, plus a
    // sibling level whose booleans are explicitly false rather than absent.
    name: 'lists/marker-font-theme-token',
    document: listDoc({
      items: ['Token', { text: 'Explicit false', level: 1 }],
      levels: [
        { level: 0, format: 'bullet', text: '•', font: { color: 'primary' } },
        {
          level: 1,
          format: 'bullet',
          text: '◦',
          font: { bold: false, italic: false, underline: false },
        },
      ],
    }),
  },

  // --------------------------------------------------------------------
  // List-level layout: indent shorthand, spacing, paragraph alignment.
  // --------------------------------------------------------------------
  {
    // `indent` as a bare number and as an object, on the shorthand path where
    // it is read at all. Two lists so the two shapes stay distinguishable.
    name: 'lists/indent-shorthands',
    document: doc([
      list({ items: ['Number shorthand'], format: 'numbered', indent: 45 }),
      list({
        items: ['Object shorthand'],
        format: 'numbered',
        indent: { left: 90, hanging: 22 },
      }),
      // With explicit levels the list-level `indent` is ignored: the level's
      // own indent (or the default) wins.
      list({
        items: ['Ignored on the explicit path'],
        indent: 200,
        levels: [{ level: 0, format: 'decimal', text: '%1.' }],
      }),
    ]),
  },
  {
    // Spacing lands on the first item (`before`), the last (`after`) and
    // every other one (`item`) — three different paragraphs, one prop each.
    name: 'lists/spacing',
    document: listDoc({
      items: ['First', 'Middle', 'Also middle', 'Last'],
      spacing: { before: 18, after: 24, item: 6 },
    }),
  },
  {
    // A single-item list with spacing: first and last are the same paragraph,
    // so `after` and `item` collide on it.
    name: 'lists/spacing-single-item',
    document: listDoc({
      items: ['Alone'],
      spacing: { before: 12, after: 12, item: 3 },
    }),
  },
  {
    // Paragraph alignment across the whole list, every member of the union.
    name: 'lists/alignment',
    document: doc([
      list({ items: ['Left aligned'], alignment: 'left' }),
      list({ items: ['Centre aligned'], alignment: 'center' }),
      list({ items: ['Right aligned'], alignment: 'right' }),
      list({
        items: [
          'Justified, which needs enough text to actually wrap onto a second line before the difference is visible at all.',
        ],
        alignment: 'justify',
      }),
    ]),
  },

  // --------------------------------------------------------------------
  // Item content.
  // --------------------------------------------------------------------
  {
    // Item text goes through the decorator parser: bold, italic, both, the
    // underscore spellings of each, and a line break — which keeps the item
    // one numbered paragraph rather than splitting it in two.
    name: 'lists/rich-text-items',
    document: listDoc({
      items: [
        'Plain item',
        '**Bold** at the start',
        'Italic *in the middle* of a line',
        '***Bold italic*** together',
        '__Underscore bold__ and _underscore italic_',
        'A **run** with *several* decorated ***spans*** in one item',
        'First line\nSecond line, same item',
      ],
    }),
  },
  {
    // Internal links to bookmarked items, written with the markdown link
    // syntax and an `#id` target.
    //
    // Deliberately no external `[text](url)` link anywhere in this file: the
    // docx library mints a random relationship id for every external
    // hyperlink, so a document containing one is not byte-stable and cannot
    // be a corpus case at all.
    name: 'lists/item-internal-links',
    document: doc([
      list({
        items: [
          { text: 'Anchor item', id: 'link-target' },
          { text: 'Nested anchor', level: 1, id: 'link-target-nested' },
          'Jump to [the anchor](#link-target)',
          '**Bold** before [the nested anchor](#link-target-nested) and plain after',
        ],
        format: 'numbered',
      }),
    ]),
  },
  {
    // Bookmarked items referenced from a paragraph by `[@id]`, in each
    // reference format the token accepts. The list is numbered so the
    // cross-references carry a cached counter.
    name: 'lists/item-cross-references',
    document: doc([
      list({
        items: [
          { text: 'First requirement', id: 'req-1' },
          { text: 'Second requirement', id: 'req-2' },
          { text: 'Nested requirement', level: 1, id: 'req-2a' },
        ],
        format: 'numbered',
      }),
      {
        name: 'paragraph',
        props: {
          text: 'See [@req-1], [@req-2:relative], [@req-2a:no_context] and [@req-2:full_context].',
        },
      },
    ]),
  },
  {
    // Tracked changes on items: an insertion, a deletion, a mixed item and a
    // fully deleted one (empty new text, which would otherwise be skipped).
    name: 'lists/item-revisions',
    document: listDoc({
      items: [
        { text: 'Untouched item' },
        {
          text: 'Inserted item',
          revision: {
            author: 'Reviewer',
            date: '2020-01-01T00:00:00Z',
            segments: [{ type: 'insert', text: 'Inserted item' }],
          },
        },
        {
          text: '',
          revision: {
            author: 'Reviewer',
            date: '2020-01-01T00:00:00Z',
            segments: [{ type: 'delete', text: 'Removed item' }],
          },
        },
        {
          text: 'Kept and rewritten',
          revision: {
            segments: [
              { type: 'equal', text: 'Kept ' },
              { type: 'delete', text: 'old ' },
              { type: 'insert', text: 'and rewritten' },
            ],
          },
        },
      ],
      format: 'numbered',
    }),
  },
  {
    // A review comment anchored to the list as a whole: it opens on the first
    // rendered item and closes on the last, with a reply thread and the
    // resolved flag.
    name: 'lists/comment-thread',
    document: listDoc({
      items: ['First', 'Second', 'Third'],
      comment: {
        text: 'Does this cover the third case?\nSecond paragraph of the comment.',
        author: 'Reviewer',
        initials: 'RV',
        date: '2020-01-01T00:00:00Z',
        replies: [
          {
            text: 'It does now.',
            author: 'Author',
            initials: 'AU',
            date: '2020-01-02T00:00:00Z',
          },
        ],
        resolved: true,
      },
    }),
  },
  {
    // Empty and whitespace-only items are dropped, which shifts both the
    // numbering and the comment anchors: the range must open on the first
    // item that actually renders and close on the last.
    name: 'lists/empty-items-skipped',
    document: listDoc({
      items: ['', '   ', 'First rendered', '', 'Last rendered', '  '],
      format: 'numbered',
      spacing: { before: 12, after: 12, item: 4 },
      comment: {
        text: 'Anchored across the rendered span',
        author: 'Reviewer',
      },
    }),
  },
  {
    // Non-Latin scripts, combining marks and an RTL run in item text, none of
    // which the numbering should care about.
    name: 'lists/unicode-items',
    document: listDoc({
      items: [
        '日本語の項目',
        'Пункт списка',
        'عنصر القائمة',
        'Café with a combining acute',
        'Em — dash, ellipsis … and  nbsp',
      ],
    }),
  },

  // --------------------------------------------------------------------
  // Numbering identity and document-level interaction.
  // --------------------------------------------------------------------
  {
    // Two lists sharing one reference: the second registration is a no-op, so
    // both lists render against the same abstract numbering and the counter
    // carries across the paragraph between them.
    name: 'lists/shared-reference',
    document: doc([
      list({
        items: ['One', 'Two'],
        reference: 'corpus-shared',
        format: 'numbered',
      }),
      { name: 'paragraph', props: { text: 'An interruption.' } },
      list({
        items: ['Three', 'Four'],
        reference: 'corpus-shared',
        // Deliberately different props: the first registration wins, so these
        // must have no effect at all.
        format: 'upperRoman',
        start: 40,
      }),
    ]),
  },
  {
    // Two lists with no reference at all: each gets its own generated one, so
    // the second restarts. This is the case that catches a registry whose
    // counter leaks between documents.
    name: 'lists/independent-references',
    document: doc([
      list({ items: ['One', 'Two'], format: 'numbered' }),
      { name: 'paragraph', props: { text: 'An interruption.' } },
      list({ items: ['One again', 'Two again'], format: 'numbered' }),
    ]),
  },
  {
    // `componentDefaults.list` supplies props to every list; the second list
    // overrides one of them, and `deepMerge` replaces `items` wholesale.
    name: 'lists/component-defaults',
    document: doc(
      [
        list({ items: ['Inherits the default format'] }),
        list({ items: ['Overrides it'], format: 'upperRoman' }),
      ],
      {
        componentDefaults: {
          list: {
            format: 'numbered',
            spacing: { before: 6, after: 6, item: 3 },
            alignment: 'right',
          },
        },
      }
    ),
  },
  {
    // A disabled list is dropped before rendering, which must not consume a
    // numbering reference from the surrounding lists.
    name: 'lists/disabled',
    document: doc([
      list({ items: ['Kept'], format: 'numbered' }),
      { ...list({ items: ['Dropped'], format: 'numbered' }), enabled: false },
      list({ items: ['Also kept'], format: 'numbered' }),
    ]),
  },
  {
    // Lists among headings and paragraphs, which is how they actually appear:
    // this pins the paragraph ordering and the spacing between neighbours.
    name: 'lists/in-document-flow',
    document: doc([
      { name: 'heading', props: { text: 'Deliverables', level: 1 } },
      { name: 'paragraph', props: { text: 'The supplier shall provide:' } },
      list({
        items: [
          'Monthly report',
          { text: 'Air quality summary', level: 1 },
          { text: 'Sensor uptime', level: 1 },
          'Quarterly review',
        ],
        format: 'numbered',
        spacing: { before: 6, after: 12, item: 3 },
      }),
      {
        name: 'paragraph',
        props: { text: 'Each item is due on the first working day.' },
      },
      { name: 'heading', props: { text: 'Exclusions', level: 2 } },
      list({ items: ['Hardware replacement', 'On-site calibration'] }),
    ]),
  },
];
