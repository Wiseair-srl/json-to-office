/**
 * DOCX parity corpus — text.
 *
 * Paragraph- and run-level surface: plain text, the markdown decorator parser,
 * font resolution, alignment, spacing, indentation, tab stops, breaks,
 * proofing language and the awkward corners around them (empty text, unclosed
 * decorators, decorators that straddle a newline, paragraph text that is
 * secretly a markdown list).
 *
 * One case per feature, kept small on purpose: the corpus is hash-based, so a
 * case name is the whole diagnosis when a hash moves.
 *
 * Two text features are deliberately absent:
 *
 * - Real external hyperlinks (`[text](url)` on the linkifying path). docx@9.7.1
 *   mints each hyperlink relationship id from `Math.random`, and nothing in the
 *   packaging step canonicalizes it, so a document containing one is not
 *   byte-stable and cannot carry a golden hash. `text/link-syntax-literal`
 *   covers the non-linkifying halves of the same syntax instead.
 * - The `text-space-after` component. It exists only as a legacy plugin
 *   component and is not in the JSON component registry, so a document using it
 *   fails validation with `unknown_component` before it can render.
 */

import type { CorpusCase } from './corpus-types';

const doc = (
  children: unknown[],
  props: Record<string, unknown> = {}
): unknown => ({
  name: 'docx',
  props: {
    theme: 'minimal',
    metadata: { title: 'Text corpus', author: 'JTO' },
    ...props,
  },
  children,
});

const section = (
  children: unknown[],
  props: Record<string, unknown> = {}
): unknown => ({ name: 'section', props, children });

/** A paragraph component; every case in this file is built out of these. */
const p = (props: Record<string, unknown>): unknown => ({
  name: 'paragraph',
  props,
});

/** One section holding the given paragraphs — the shape most cases want. */
const page = (
  children: unknown[],
  docProps: Record<string, unknown> = {}
): unknown => doc([section(children)], docProps);

export const CASES: CorpusCase[] = [
  // --------------------------------------------------------------------------
  // Baseline
  // --------------------------------------------------------------------------
  {
    name: 'text/plain',
    document: page([
      p({ text: 'The quick brown fox jumps over the lazy dog.' }),
      p({ text: 'A second paragraph, with no props beyond its text.' }),
    ]),
  },
  {
    name: 'text/empty-and-whitespace',
    document: page([
      p({ text: '' }),
      p({ text: ' ' }),
      p({ text: '   \n   ' }),
      p({ text: 'After the blanks.' }),
      p({ text: '' }),
    ]),
  },

  // --------------------------------------------------------------------------
  // Markdown decorator parsing
  // --------------------------------------------------------------------------
  {
    name: 'text/decorators-emphasis',
    document: page([
      p({ text: 'Asterisks: **bold**, *italic*, ***bold italic***.' }),
      p({ text: 'Underscores: __bold__, _italic_, ___bold italic___.' }),
      p({ text: '**Whole paragraph is bold.**' }),
      p({ text: 'Adjacent runs: **one***two*__three__ end.' }),
    ]),
  },
  {
    name: 'text/decorators-edge-cases',
    document: page([
      // Unclosed markers stay literal.
      p({ text: 'Unclosed **bold and unclosed *italic.' }),
      // Empty payloads.
      p({ text: 'Empty pairs: **** and __ and ** **.' }),
      // A marker that is really part of an identifier.
      p({ text: 'Identifier snake_case_name and file_name_here.txt.' }),
      // Markers hugging the edges of the paragraph.
      p({ text: '*edge* middle *edge*' }),
      // A backslash escapes the marker that follows it.
      p({ text: 'Escaped \\*not italic\\* stays literal.' }),
      // A backslash before anything else is just a backslash.
      p({ text: 'Path C:\\temp and 50\\% are untouched.' }),
      // Code, the reason escapes exist: two underscores would pair.
      p({ text: 'Escaped grant\\_type=client\\_credentials reads as typed.' }),
    ]),
  },
  {
    name: 'text/decorators-across-newlines',
    document: page([
      p({ text: '**bold start\nbold end** then plain.' }),
      p({ text: '*italic spanning\ntwo lines* and back.' }),
    ]),
  },
  {
    name: 'text/bold-color',
    document: page([
      p({ text: 'Hex bold colour: **highlighted**.', boldColor: '#B91C1C' }),
      p({
        text: 'Theme-token bold colour: **highlighted**.',
        boldColor: 'primary',
      }),
      p({
        text: 'Bold colour with a font colour: **bold** vs plain.',
        boldColor: '#0F766E',
        font: { color: '#334155' },
      }),
    ]),
  },

  // --------------------------------------------------------------------------
  // Line, tab and page breaks
  // --------------------------------------------------------------------------
  {
    name: 'text/line-breaks',
    document: page([
      p({ text: 'Line one\nLine two\nLine three' }),
      p({ text: 'Gap below\n\n\nafter three newlines' }),
      p({ text: '\nLeading newline' }),
      p({ text: 'Trailing newline\n' }),
    ]),
  },
  {
    name: 'text/tab-stops',
    document: page([
      p({
        text: 'Left\tCentre\tRight',
        tabStops: [
          { type: 'center', position: 3000 },
          { type: 'right', position: 6000 },
        ],
      }),
      p({
        text: 'Item\t12.50',
        tabStops: [{ type: 'decimal', position: 5000, leader: 'dot' }],
      }),
      p({
        text: 'Leaders\thyphen\tunderscore',
        tabStops: [
          { type: 'left', position: 2500, leader: 'hyphen' },
          { type: 'left', position: 5000, leader: 'underscore' },
        ],
      }),
      p({
        text: 'Bar\tand middle dot',
        tabStops: [
          { type: 'bar', position: 2000 },
          { type: 'left', position: 4000, leader: 'middleDot' },
        ],
      }),
      p({
        text: 'Explicit none\tleader',
        tabStops: [{ type: 'right', position: 8000, leader: 'none' }],
      }),
      // Tabs with no stops declared at all.
      p({ text: 'No stops\tdeclared\there' }),
      // Stops declared but no tab character in the text.
      p({
        text: 'Stops but no tab characters',
        tabStops: [{ type: 'left', position: 1200 }],
      }),
    ]),
  },
  {
    name: 'text/breaks-and-keeps',
    document: page([
      p({ text: 'Before the break.' }),
      p({ text: 'This paragraph starts a new page.', pageBreak: true }),
      p({ text: 'Kept with the next paragraph.', keepNext: true }),
      p({ text: 'Lines kept together on one page.', keepLines: true }),
      p({ text: 'Both keeps at once.', keepNext: true, keepLines: true }),
      p({
        text: 'Keeps and a page break together.',
        pageBreak: true,
        keepNext: true,
      }),
    ]),
  },
  {
    name: 'text/column-break',
    document: doc([
      section([
        {
          name: 'columns',
          props: { columns: 2, gap: 18 },
          children: [
            p({ text: 'First column, first paragraph.' }),
            p({ text: 'Pushed into the second column.', columnBreak: true }),
            p({ text: 'Still in the second column.' }),
          ],
        },
      ]),
    ]),
  },

  // --------------------------------------------------------------------------
  // Paragraph geometry
  // --------------------------------------------------------------------------
  {
    name: 'text/alignment',
    document: page([
      p({ text: 'Left aligned.', alignment: 'left' }),
      p({ text: 'Centre aligned.', alignment: 'center' }),
      p({ text: 'Right aligned.', alignment: 'right' }),
      p({
        text: 'Justified text needs enough words to actually stretch across the full measure of the page, so here they are.',
        alignment: 'justify',
      }),
      p({ text: 'No alignment set at all — theme default.' }),
    ]),
  },
  {
    name: 'text/indent',
    document: page([
      p({ text: 'Left indent only.', indent: { left: 720 } }),
      p({ text: 'Left and right indent.', indent: { left: 720, right: 720 } }),
      p({
        text: 'First line indented, the rest of this paragraph sits back at the left indent where it belongs.',
        indent: { left: 360, firstLine: 720 },
      }),
      p({
        text: 'Hanging indent: the first line hangs out to the left while every following line is pushed in.',
        indent: { left: 1080, hanging: 540 },
      }),
      // Negative left/right are allowed: they pull into the margin.
      p({
        text: 'Negative indents pull into the margin.',
        indent: { left: -360, right: -180 },
      }),
      p({ text: 'Zero indent, explicitly.', indent: { left: 0, right: 0 } }),
    ]),
  },
  {
    name: 'text/spacing',
    document: page([
      p({ text: 'Space before only.', spacing: { before: 24 } }),
      p({ text: 'Space after only.', spacing: { after: 24 } }),
      p({ text: 'Both before and after.', spacing: { before: 12, after: 12 } }),
      p({ text: 'Explicit zero spacing.', spacing: { before: 0, after: 0 } }),
      p({ text: 'Empty spacing object.', spacing: {} }),
    ]),
  },
  {
    name: 'text/line-spacing',
    document: page([
      p({ text: 'Single spaced.', font: { lineSpacing: { type: 'single' } } }),
      p({ text: 'Double spaced.', font: { lineSpacing: { type: 'double' } } }),
      p({
        text: 'At least 400 twips per line, which only matters once the line is tall enough to care.',
        font: { lineSpacing: { type: 'atLeast', value: 400 } },
      }),
      p({
        text: 'Exactly 300 twips per line, clipping anything taller.',
        font: { lineSpacing: { type: 'exactly', value: 300 } },
      }),
      p({
        text: 'One and a half lines, expressed as a multiple.',
        font: { lineSpacing: { type: 'multiple', value: 1.5 } },
      }),
      // Types that normally carry a value, with the value omitted.
      p({
        text: 'atLeast with no value.',
        font: { lineSpacing: { type: 'atLeast' } },
      }),
      p({
        text: 'Zero value.',
        font: { lineSpacing: { type: 'multiple', value: 0 } },
      }),
    ]),
  },

  // --------------------------------------------------------------------------
  // Run formatting
  // --------------------------------------------------------------------------
  {
    name: 'text/font-family',
    document: page([
      p({ text: 'Georgia, a safe serif.', font: { family: 'Georgia' } }),
      p({ text: 'Consolas, a safe mono.', font: { family: 'Consolas' } }),
      p({
        text: 'Times New Roman, with a space in the name.',
        font: { family: 'Times New Roman' },
      }),
      p({ text: 'Trebuchet MS.', font: { family: 'Trebuchet MS' } }),
    ]),
  },
  {
    name: 'text/font-size-and-color',
    document: page([
      p({ text: 'Smallest allowed size.', font: { size: 8 } }),
      p({ text: 'Largest allowed size.', font: { size: 120 } }),
      p({ text: 'Half-point size.', font: { size: 10.5 } }),
      p({ text: 'Hex colour.', font: { color: '#7C3AED' } }),
      p({ text: 'Theme token colour.', font: { color: 'primary' } }),
      p({ text: 'Another theme token.', font: { color: 'secondary' } }),
      p({
        text: 'Size and colour together.',
        font: { size: 18, color: '#0F172A' },
      }),
    ]),
  },
  {
    name: 'text/font-emphasis',
    document: page([
      p({ text: 'Bold via props.', font: { bold: true } }),
      p({ text: 'Italic via props.', font: { italic: true } }),
      p({ text: 'Underlined via props.', font: { underline: true } }),
      p({
        text: 'All three at once.',
        font: { bold: true, italic: true, underline: true },
      }),
      p({
        text: 'Explicitly off.',
        font: { bold: false, italic: false, underline: false },
      }),
      // Props emphasis interacting with inline decorators.
      p({ text: 'Italic base with **bold** inside.', font: { italic: true } }),
    ]),
  },
  {
    name: 'text/font-weight',
    document: page([
      p({
        text: 'Thin, weight 100.',
        font: { family: 'Arial', fontWeight: 100 },
      }),
      p({
        text: 'Light, weight 300.',
        font: { family: 'Arial', fontWeight: 300 },
      }),
      p({
        text: 'Regular, weight 400.',
        font: { family: 'Arial', fontWeight: 400 },
      }),
      p({
        text: 'Bold, weight 700.',
        font: { family: 'Arial', fontWeight: 700 },
      }),
      p({
        text: 'Black, weight 900.',
        font: { family: 'Arial', fontWeight: 900 },
      }),
      // fontWeight wins over bold when both are set.
      p({
        text: 'bold:true plus fontWeight:300.',
        font: { family: 'Arial', bold: true, fontWeight: 300 },
      }),
    ]),
  },
  {
    name: 'text/character-spacing',
    document: page([
      p({
        text: 'Condensed tracking.',
        font: { characterSpacing: { type: 'condensed', value: 20 } },
      }),
      p({
        text: 'Expanded tracking.',
        font: { characterSpacing: { type: 'expanded', value: 40 } },
      }),
      p({
        text: 'Zero tracking.',
        font: { characterSpacing: { type: 'expanded', value: 0 } },
      }),
      p({
        text: 'Negative value on expanded.',
        font: { characterSpacing: { type: 'expanded', value: -15 } },
      }),
      p({
        text: 'Negative value on condensed.',
        font: { characterSpacing: { type: 'condensed', value: -15 } },
      }),
      p({
        text: 'Tracking plus **decorated** runs.',
        font: { characterSpacing: { type: 'expanded', value: 25 }, size: 14 },
      }),
    ]),
  },
  {
    name: 'text/scale',
    document: page([
      p({ text: 'Minimum scale.', font: { scale: 1 } }),
      p({ text: 'Compressed glyphs.', font: { scale: 55 } }),
      p({ text: 'Normal width.', font: { scale: 100 } }),
      p({ text: 'Slightly expanded.', font: { scale: 115 } }),
      p({ text: 'Maximum scale.', font: { scale: 600 } }),
    ]),
  },
  {
    name: 'text/font-partial-override',
    document: page([
      // `family` is optional on a paragraph override: everything else inherits.
      p({ text: 'Size only, family inherited.', font: { size: 16 } }),
      p({ text: 'Colour only.', font: { color: '#B45309' } }),
      p({ text: 'Italic only.', font: { italic: true } }),
      p({ text: 'Empty font object.', font: {} }),
      p({
        text: 'Everything except family.',
        font: {
          size: 13,
          color: '#1E293B',
          bold: true,
          italic: true,
          underline: true,
          scale: 105,
          characterSpacing: { type: 'expanded', value: 10 },
          lineSpacing: { type: 'multiple', value: 1.2 },
          spacing: { before: 6, after: 6 },
        },
      }),
    ]),
  },

  // --------------------------------------------------------------------------
  // Named styles
  // --------------------------------------------------------------------------
  {
    name: 'text/theme-style-builtin',
    document: page([
      p({ text: 'Normal style.', themeStyle: 'normal' }),
      p({ text: 'Title style.', themeStyle: 'title' }),
      p({ text: 'Subtitle style.', themeStyle: 'subtitle' }),
      p({ text: 'Heading 1 look, no outline level.', themeStyle: 'heading1' }),
      p({ text: 'Heading 2 look.', themeStyle: 'heading2' }),
      p({ text: 'Heading 3 look.', themeStyle: 'heading3' }),
      p({ text: 'Heading 4 look.', themeStyle: 'heading4' }),
      p({ text: 'Heading 5 look.', themeStyle: 'heading5' }),
      p({ text: 'Heading 6 look.', themeStyle: 'heading6' }),
      // Case-insensitive style keys.
      p({ text: 'Mixed-case key.', themeStyle: 'Heading2' }),
    ]),
  },
  {
    name: 'text/theme-style-custom',
    document: page(
      [
        p({ text: 'A callout, styled by name.', themeStyle: 'calloutText' }),
        p({
          text: 'A second callout so the between-border has something to sit between.',
          themeStyle: 'calloutText',
        }),
        p({
          text: 'A quote, with its own indent and borders.',
          themeStyle: 'pullQuote',
        }),
        // Style plus local overrides on the same paragraph.
        p({
          text: 'Callout with a local colour override.',
          themeStyle: 'calloutText',
          font: { color: '#7C2D12' },
          alignment: 'right',
        }),
        // A style name that no theme defines.
        p({ text: 'Style that does not exist.', themeStyle: 'noSuchStyle' }),
      ],
      {
        themeOverrides: {
          styles: {
            calloutText: {
              font: 'body',
              size: 12,
              color: '#0F766E',
              bold: true,
              alignment: 'left',
              spacing: { before: 8, after: 8 },
              indent: { left: 360 },
              borders: {
                left: { style: 'single', size: 12, color: '#0F766E', space: 6 },
                between: {
                  style: 'dotted',
                  size: 6,
                  color: '#94A3B8',
                  space: 2,
                },
              },
            },
            pullQuote: {
              font: 'light',
              size: 14,
              italic: true,
              color: '#475569',
              alignment: 'center',
              indent: { left: 720, hanging: 0 },
              keepLinesTogether: true,
              borders: {
                top: { style: 'double', size: 8, color: '#CBD5E1', space: 4 },
                bottom: {
                  style: 'double',
                  size: 8,
                  color: '#CBD5E1',
                  space: 4,
                },
              },
            },
          },
        },
      }
    ),
  },

  // --------------------------------------------------------------------------
  // Proofing
  // --------------------------------------------------------------------------
  {
    name: 'text/language-override',
    document: page(
      [
        p({ text: 'This inherits the document default language.' }),
        p({ text: 'Ce paragraphe est en français.', language: 'fr-FR' }),
        p({ text: 'Dieser Absatz ist auf Deutsch.', language: 'de-DE' }),
        p({ text: 'Questo paragrafo è in italiano.', language: 'it-IT' }),
        // A tag with a script and region subtag.
        p({ text: 'Serbian in Latin script.', language: 'sr-Latn-RS' }),
      ],
      { language: 'en-US' }
    ),
  },
  {
    name: 'text/no-proof',
    document: page(
      [
        p({ text: 'Ordinary prose, spell-checked as normal.' }),
        p({ text: 'const noProof = true; // not prose', noProof: true }),
        p({ text: 'Wiseair ships json-to-office and pptx output.' }),
        p({
          text: 'Local allowlist covers Filaferro here only.',
          noProofWords: ['Filaferro'],
        }),
        // Case-insensitivity and repeated hits in one paragraph.
        p({ text: 'WISEAIR, wiseair and Wiseair are all the same word.' }),
        // Allowlist plus noProof on the same paragraph.
        p({
          text: 'Both switches: Filaferro and prose.',
          noProof: true,
          noProofWords: ['Filaferro'],
        }),
        // A word that only looks like an allowlisted one.
        p({ text: 'But Wiseairy is not on the list.' }),
      ],
      { language: 'en-US', noProofWords: ['Wiseair', 'json-to-office', 'pptx'] }
    ),
  },

  // --------------------------------------------------------------------------
  // Inline tokens
  // --------------------------------------------------------------------------
  {
    name: 'text/link-syntax-literal',
    document: page([
      // Brackets with no `(target)` after them are never link syntax.
      p({ text: 'Brackets [without a target] stay literal.' }),
      p({ text: 'A bracket [pair] and a separate (parenthetical).' }),
      // A placeholder in the text routes the paragraph through the placeholder
      // parser, which does not linkify: the markdown stays literal.
      p({ text: 'Page {PAGE}: [not a link](https://example.com) here.' }),
      // Decorators still apply on that path.
      p({ text: 'Page {PAGE} with **bold** and *italic* intact.' }),
    ]),
  },
  {
    name: 'text/placeholders',
    document: page(
      [
        p({ text: 'Page {PAGE} of {TOTAL_PAGES}.' }),
        p({ text: 'Generated {DATE} at {DATETIME}, year {YEAR}.' }),
        p({ text: 'Unknown {NOT_A_PLACEHOLDER} stays literal.' }),
        p({ text: 'A placeholder inside **bold {PAGE}** text.' }),
        p({ text: 'Braces with {} nothing inside.' }),
      ],
      {
        metadata: {
          title: 'Text corpus',
          author: 'JTO',
          date: '2020-01-02T03:04:05.000Z',
        },
      }
    ),
  },
  {
    name: 'text/bookmark-ids',
    document: page([
      p({ text: 'First anchor.', id: 'intro' }),
      p({ text: 'Second anchor.', id: 'summary' }),
      p({ text: 'An anchor with punctuation in its id.', id: 'section.1-a' }),
    ]),
  },

  // --------------------------------------------------------------------------
  // Awkward corners
  // --------------------------------------------------------------------------
  {
    name: 'text/markdown-lists',
    document: page([
      // Paragraph text that is entirely markdown list syntax becomes a list.
      p({
        text: '- First bullet\n- Second bullet\n  - Nested bullet\n    - Deeply nested',
      }),
      p({ text: '1. First step\n2. Second step\n  1. Nested step' }),
      // A list that carries paragraph-level spacing and alignment.
      p({
        text: '- Spaced bullet\n- Another one',
        spacing: { before: 10, after: 10 },
        alignment: 'center',
      }),
      // Decorators inside list items.
      p({ text: '- **Bold** item\n- *Italic* item' }),
      // One non-list line is enough to keep it a plain paragraph.
      p({ text: '- Looks like a list\nbut this line does not' }),
    ]),
  },
  {
    name: 'text/unicode-and-xml-escapes',
    document: page([
      p({ text: 'XML specials: < > & " \' and </w:t> in prose.' }),
      p({ text: 'Accents: àéîõü ÀÉÎÕÜ çñß.' }),
      p({ text: 'CJK: 日本語のテキスト、中文文本、한국어 텍스트.' }),
      p({ text: 'Greek and Cyrillic: αβγδε ЖЗИЙК.' }),
      p({ text: 'Right-to-left Arabic: مرحبا بالعالم.' }),
      p({ text: 'Right-to-left Hebrew: שלום עולם.' }),
      p({ text: 'Mixed direction: the word سلام inside English.' }),
      p({ text: 'Emoji: ✅ 🚀 — and a dingbat ❦.' }),
      p({
        text: 'Punctuation: en–dash, em—dash, ellipsis…, “curly quotes”, ‘single’.',
      }),
      p({ text: 'Non-breaking space and soft­hyphen.' }),
      p({ text: 'Maths: ≤ ≥ ≠ ± × ÷ ∑ ∞ µg/m³.' }),
    ]),
  },
  {
    name: 'text/floating-frame',
    document: page([
      p({
        text: 'A floating frame anchored to the margin.',
        floating: {
          horizontalPosition: { relative: 'margin', align: 'right' },
          verticalPosition: { relative: 'text', offset: 240 },
          wrap: { type: 'around' },
          width: 3000,
          height: 1200,
          lockAnchor: true,
        },
      }),
      p({
        text: 'A floating frame positioned by percentage offset.',
        floating: {
          horizontalPosition: { relative: 'page', offset: '25%' },
          verticalPosition: { relative: 'page', offset: '10%' },
          wrap: { type: 'none' },
        },
      }),
      p({ text: 'Ordinary flowing text that the frames sit beside.' }),
    ]),
  },
  {
    name: 'text/all-features-combined',
    document: page(
      [
        p({
          text: 'Heading-ish\tcombined **bold**, *italic* and a {PAGE} field.',
          themeStyle: 'normal',
          font: {
            family: 'Georgia',
            size: 12.5,
            color: '#1F2937',
            bold: false,
            italic: false,
            underline: false,
            scale: 98,
            characterSpacing: { type: 'expanded', value: 12 },
            lineSpacing: { type: 'multiple', value: 1.35 },
          },
          boldColor: '#B91C1C',
          alignment: 'justify',
          spacing: { before: 9, after: 9 },
          indent: { left: 480, right: 240, firstLine: 240 },
          tabStops: [{ type: 'right', position: 8500, leader: 'dot' }],
          language: 'en-GB',
          noProofWords: ['Wiseair'],
          keepNext: true,
          keepLines: true,
          id: 'combined',
        }),
        p({
          text: 'A second combined paragraph, on its own page, hanging and right-aligned.',
          pageBreak: true,
          alignment: 'right',
          indent: { left: 900, hanging: 450 },
          font: {
            size: 11,
            italic: true,
            characterSpacing: { type: 'condensed', value: 8 },
          },
          spacing: { before: 0, after: 18 },
        }),
      ],
      { language: 'en-US', noProofWords: ['json-to-office'] }
    ),
  },
];
