/**
 * DOCX parity corpus — annotations.
 *
 * Everything a reviewer adds on top of the text rather than inside it: Word
 * review comments (`word/comments.xml` plus the anchors that point at them),
 * footnote and endnote bodies bound to inline `[^id]` markers, tracked changes
 * (`w:ins` / `w:del`) on runs, on whole table rows, and the document-level
 * `w:trackRevisions` switch.
 *
 * All three features mint document-scoped OOXML ids from per-render counters,
 * so ordering is part of what a hash pins here: several cases deliberately mix
 * components to fix the order in which ids are handed out.
 *
 * Determinism: every author, date and initials value below is written out
 * literally. Comments and revisions both fall back to the Unix epoch when a
 * date is omitted, which is itself deterministic, so the "defaults" cases pin
 * that fallback rather than avoiding it. No case uses a real external
 * hyperlink — docx mints those relationship ids from `Math.random`, which no
 * hash can survive.
 *
 * Two combinations are absent because the schema or the deep validator refuses
 * them, so they cannot be corpus cases:
 *
 * - `revision` together with `footnotes` / `endnotes` on the same paragraph.
 *   Tracked-change text is rendered literally and `w:ins` / `w:del` have no
 *   room for a reference run, so the validator rejects the pair outright.
 * - A comment or a revision on a `heading` carrying notes: `heading` has no
 *   `footnotes` / `endnotes` props at all.
 *
 * And one that the schema allows but the pipeline cannot yet render stably: a
 * note inside a `text-box`. See `annotations/notes-in-nested-components`.
 */

import type { CorpusCase } from './corpus-types';

// --- fixed identities -------------------------------------------------------
// Names and timestamps are constants so a reviewer editing one case cannot
// accidentally move another case's hash.

const ADA = 'Ada Lovelace';
const GRACE = 'Grace Hopper';
const LEGAL = 'legal.desk';
const DATE_A = '2026-01-15T09:30:00Z';
const DATE_B = '2026-01-16T14:05:00Z';
const DATE_C = '2026-02-02T08:00:00Z';

const doc = (
  children: unknown[],
  props: Record<string, unknown> = {}
): unknown => ({
  name: 'docx',
  props: {
    theme: 'minimal',
    metadata: { title: 'Annotations corpus', author: 'JTO' },
    ...props,
  },
  children,
});

const p = (props: Record<string, unknown>): unknown => ({
  name: 'paragraph',
  props,
});

const h = (props: Record<string, unknown>): unknown => ({
  name: 'heading',
  props,
});

export const CASES: CorpusCase[] = [
  // ==========================================================================
  // Comments
  // ==========================================================================
  {
    // The baseline: no author, no initials, no date. Word gets
    // "json-to-office" and the epoch, and the body is one paragraph.
    name: 'annotations/comment-defaults',
    document: doc([
      p({
        text: 'Revenue grew 12% year on year.',
        comment: { text: 'Check.' },
      }),
    ]),
  },
  {
    // Authorship: explicit initials, initials derived from a spaced name, and
    // initials derived from a dotted handle (the separator split, not just
    // whitespace).
    name: 'annotations/comment-metadata',
    document: doc([
      p({
        text: 'Explicit author, initials and date.',
        comment: {
          text: 'Confirm this figure with finance.',
          author: ADA,
          initials: 'AL',
          date: DATE_A,
        },
      }),
      p({
        text: 'Initials derived from a two-word author.',
        comment: { text: 'Derived initials.', author: GRACE, date: DATE_B },
      }),
      p({
        text: 'Initials derived from a dotted handle.',
        comment: { text: 'Handle-shaped author.', author: LEGAL, date: DATE_B },
      }),
      p({
        text: 'Author with no date falls back to the epoch.',
        comment: { text: 'Dateless.', author: ADA },
      }),
    ]),
  },
  {
    // Body text: newlines split the body into comment-pane paragraphs, and
    // non-ASCII has to survive both the body and the author attribute.
    name: 'annotations/comment-body-text',
    document: doc([
      p({
        text: 'Multi-paragraph comment body.',
        comment: {
          text: 'First line.\nSecond line.\n\nFourth line after a blank one.',
          author: ADA,
          date: DATE_A,
        },
      }),
      p({
        text: 'Comment written in another script.',
        comment: {
          text: 'Cifra da verificare — «fatturato» 12 %.\n確認してください。',
          author: 'Ana Ruíz-Gómez',
          date: DATE_B,
        },
      }),
    ]),
  },
  {
    // A thread: root plus replies, each anchored over the same range, each with
    // its own author, initials and date.
    name: 'annotations/comment-thread',
    document: doc([
      p({
        text: 'The fee is 12% of revenue.',
        comment: {
          text: 'Confirm with finance.',
          author: ADA,
          initials: 'AL',
          date: DATE_A,
          replies: [
            {
              text: 'Confirmed against the audited accounts.',
              author: GRACE,
              initials: 'GH',
              date: DATE_B,
            },
            { text: 'Thanks.', author: ADA, date: DATE_C },
          ],
        },
      }),
    ]),
  },
  {
    // `resolved` reaches word/commentsExtended.xml as w15:done, and only when
    // the document has at least one threaded comment — so both states are
    // pinned here, together with an unthreaded comment that must stay
    // parentless.
    name: 'annotations/comment-thread-resolved-state',
    document: doc([
      p({
        text: 'A settled question.',
        comment: {
          text: 'Is this the final number?',
          author: ADA,
          date: DATE_A,
          resolved: true,
          replies: [{ text: 'Yes, signed off.', author: GRACE, date: DATE_B }],
        },
      }),
      p({
        text: 'An open question.',
        comment: {
          text: 'Still checking the source.',
          author: GRACE,
          date: DATE_B,
          resolved: false,
          replies: [
            { text: 'Ping me when you know.', author: ADA, date: DATE_C },
          ],
        },
      }),
      p({
        text: 'A standalone comment in a document that has threads.',
        comment: { text: 'No replies here.', author: ADA, date: DATE_A },
      }),
    ]),
  },
  {
    // Id allocation order across every component that can carry a comment.
    // A thread in the middle consumes three ids, shifting everything after it.
    name: 'annotations/comment-id-allocation',
    document: doc([
      h({
        text: 'Findings',
        level: 1,
        comment: { text: 'First comment.', author: ADA, date: DATE_A },
      }),
      p({
        text: 'A thread takes one id per comment in it.',
        comment: {
          text: 'Root.',
          author: ADA,
          date: DATE_A,
          replies: [
            { text: 'Reply one.', author: GRACE, date: DATE_B },
            { text: 'Reply two.', author: ADA, date: DATE_C },
          ],
        },
      }),
      {
        name: 'list',
        props: {
          items: ['Alpha', 'Beta', 'Gamma'],
          comment: {
            text: 'Anchored across the whole list.',
            author: GRACE,
            date: DATE_B,
          },
        },
      },
      {
        name: 'table',
        props: {
          columns: [
            {
              header: {
                content: 'Metric',
                comment: { text: 'Header cell.', author: ADA, date: DATE_A },
              },
              cells: [
                {
                  content: 'Revenue',
                  comment: { text: 'Body cell.', author: GRACE, date: DATE_B },
                },
              ],
            },
            {
              header: { content: 'Value' },
              cells: [{ content: '12%' }],
            },
          ],
        },
      },
      p({
        text: 'Last comment in the document.',
        comment: { text: 'Sixth id.', author: ADA, date: DATE_C },
      }),
    ]),
  },
  {
    // The range has to open before the first run and close after the last, so
    // text that parses into many runs — decorators, a line break, a tab — is
    // the interesting shape.
    name: 'annotations/comment-multi-run-range',
    document: doc([
      p({
        text: 'Plain, **bold**, *italic*, ***both***, and plain again.',
        comment: {
          text: 'Range spans every run.',
          author: ADA,
          date: DATE_A,
        },
      }),
      p({
        text: 'Line one\nLine two\nLine three',
        comment: {
          text: 'Range spans the breaks.',
          author: GRACE,
          date: DATE_B,
        },
      }),
      p({
        text: 'Left\tRight',
        tabStops: [{ type: 'right', position: 6000 }],
        comment: { text: 'Range spans a tab.', author: ADA, date: DATE_B },
      }),
      p({
        text: 'Bold **and** styled, with the comment over the lot.',
        font: { size: 13, italic: true, color: '#334155' },
        alignment: 'justify',
        boldColor: '#B91C1C',
        comment: { text: 'Styled paragraph.', author: GRACE, date: DATE_C },
      }),
    ]),
  },
  {
    // Anchoring corners: paragraphs with no text of their own, the markdown
    // list branch (which returns early from the paragraph renderer), and a
    // table cell with no content at all.
    name: 'annotations/comment-anchor-edge-cases',
    document: doc([
      p({
        text: '',
        comment: {
          text: 'Comment on an empty paragraph.',
          author: ADA,
          date: DATE_A,
        },
      }),
      p({
        text: '   ',
        comment: { text: 'Comment on whitespace.', author: ADA, date: DATE_A },
      }),
      p({
        text: '- First item\n- Second item\n- Third item',
        comment: { text: 'Reorder these.', author: GRACE, date: DATE_B },
      }),
      {
        name: 'table',
        props: {
          columns: [
            {
              header: { content: 'Owner' },
              cells: [
                {
                  comment: { text: 'Fill this in.', author: ADA, date: DATE_C },
                },
              ],
            },
          ],
        },
      },
    ]),
  },
  {
    // Nested containers: the comment registry is document-scoped, so an anchor
    // inside a text box or a column layout still has to reach the same part.
    name: 'annotations/comment-in-nested-containers',
    document: doc([
      {
        name: 'text-box',
        props: { width: '60%' },
        children: [
          p({
            text: 'Boxed paragraph carrying a comment.',
            comment: { text: 'Inside a text box.', author: ADA, date: DATE_A },
          }),
          p({ text: 'A second boxed paragraph with no comment.' }),
        ],
      },
      {
        name: 'columns',
        props: { columns: 2, gap: 12 },
        children: [
          p({
            text: 'Column content carrying a comment.',
            comment: {
              text: 'Inside a column layout.',
              author: GRACE,
              date: DATE_B,
            },
          }),
          p({ text: 'More column content, uncommented.' }),
        ],
      },
    ]),
  },

  // ==========================================================================
  // Footnotes and endnotes
  // ==========================================================================
  {
    name: 'annotations/footnote-single',
    document: doc([
      p({
        text: 'Revenue grew 12%[^rev] last year.',
        footnotes: [{ id: 'rev', text: 'Source: FY26 audited accounts.' }],
      }),
    ]),
  },
  {
    // Notes are numbered in reference order, not declaration order, and the
    // counter runs across paragraphs.
    name: 'annotations/footnote-numbering-order',
    document: doc([
      p({
        text: 'First[^b] then second[^a].',
        footnotes: [
          { id: 'a', text: 'Declared first, referenced second.' },
          { id: 'b', text: 'Declared second, referenced first.' },
        ],
      }),
      p({
        text: 'A third note[^c] in the next paragraph.',
        footnotes: [{ id: 'c', text: 'Third by reference order.' }],
      }),
      p({
        text: 'Markers at both ends[^d] of a sentence.[^e]',
        footnotes: [
          { id: 'd', text: 'Mid-sentence.' },
          { id: 'e', text: 'After the full stop.' },
        ],
      }),
    ]),
  },
  {
    // One body, two references: the second marker reuses the first note's id.
    name: 'annotations/footnote-repeated-marker',
    document: doc([
      p({
        text: 'Here[^n], and again here[^n], and once more[^n].',
        footnotes: [{ id: 'n', text: 'Referenced three times.' }],
      }),
    ]),
  },
  {
    name: 'annotations/footnote-body-multiline',
    document: doc([
      p({
        text: 'See the note[^n].',
        footnotes: [
          {
            id: 'n',
            text: 'First paragraph of the note.\nSecond paragraph.\n\nFourth, after a blank line.',
          },
        ],
      }),
    ]),
  },
  {
    // A marker inside a decorated span keeps the emphasis around it, and a
    // marker hard against a decorator boundary is the awkward half.
    name: 'annotations/footnote-in-decorated-text',
    document: doc([
      p({
        text: '**Bold claim[^n]** and *an italic one[^m]*.',
        footnotes: [
          { id: 'n', text: 'About the bold claim.' },
          { id: 'm', text: 'About the italic one.' },
        ],
      }),
      p({
        text: 'A marker across a line break[^k]\nand text after it.',
        footnotes: [{ id: 'k', text: 'Before the break.' }],
      }),
      p({
        text: '[^lead] starts the paragraph.',
        footnotes: [{ id: 'lead', text: 'Leading marker.' }],
      }),
    ]),
  },
  {
    // Ids are any run of characters without whitespace or "]", so punctuation,
    // digits and non-ASCII all have to round-trip through the marker regex.
    name: 'annotations/footnote-exotic-ids',
    document: doc([
      p({
        text: 'Hyphen[^note-1], dot[^n.2], section[^§3], digits[^12], accents[^résumé].',
        footnotes: [
          { id: 'note-1', text: 'Hyphenated id.' },
          { id: 'n.2', text: 'Dotted id.' },
          { id: '§3', text: 'Section-sign id.' },
          { id: '12', text: 'All-digit id.' },
          { id: 'résumé', text: 'Accented id.' },
        ],
      }),
    ]),
  },
  {
    // Both warning paths: a declared body nothing references (dropped), and a
    // marker with no matching body (left literal in the text).
    name: 'annotations/footnote-unreferenced-and-unknown',
    document: doc([
      p({
        text: 'Typo in the marker[^oops], and the good one[^n].',
        footnotes: [
          { id: 'n', text: 'Referenced.' },
          { id: 'unused', text: 'Declared but never referenced.' },
        ],
      }),
    ]),
  },
  {
    // `[^…]` is only syntax when the paragraph declares notes: the regex
    // character class in the first paragraph must survive verbatim, even
    // though the paragraph after it uses real markers.
    name: 'annotations/footnote-marker-lookalike',
    document: doc([
      p({ text: 'The class [^a-z]+ matches anything but a lowercase letter.' }),
      p({ text: 'Also [^ ] and [^]] look like markers but are not.' }),
      p({
        text: 'This paragraph really does have one[^real].',
        footnotes: [{ id: 'real', text: 'A genuine note.' }],
      }),
    ]),
  },
  {
    name: 'annotations/endnote-single',
    document: doc([
      p({
        text: 'Sampling followed the protocol[^proto].',
        endnotes: [{ id: 'proto', text: 'See Annex B.' }],
      }),
      p({
        text: 'A second endnote[^annex] later in the document.',
        endnotes: [{ id: 'annex', text: 'See Annex C.\nAnd its addendum.' }],
      }),
    ]),
  },
  {
    // Footnotes and endnotes are separate parts with separate id spaces, so
    // both start at 1 in the same paragraph. An id declared as both resolves
    // to the footnote, with the endnote body dropped.
    name: 'annotations/endnote-with-footnote',
    document: doc([
      p({
        text: 'Both a footnote[^f] and an endnote[^e] here.',
        footnotes: [{ id: 'f', text: 'Foot of the page.' }],
        endnotes: [{ id: 'e', text: 'End of the document.' }],
      }),
      p({
        text: 'An id declared as both[^dup] prefers the footnote.',
        footnotes: [{ id: 'dup', text: 'The footnote wins.' }],
        endnotes: [{ id: 'dup', text: 'The endnote is dropped.' }],
      }),
      p({
        text: 'And a plain footnote[^g] after the collision.',
        footnotes: [{ id: 'g', text: 'Numbered after the first footnote.' }],
      }),
    ]),
  },
  {
    // Notes registered from inside nested components: a table header and cell
    // whose content is a paragraph, a column layout, and a markdown-list
    // paragraph (which returns early from the paragraph renderer and has to
    // carry the resolver with it).
    //
    // A `text-box` holding a note is deliberately absent. `text-box` is not on
    // the component cache's bypass list — `componentBypassReason` looks for
    // `comment` and `revision` in a subtree, not for `footnotes` / `endnotes` —
    // so the second document rendered in one process replays the cached box and
    // loses the note body while keeping the reference. That is not byte-stable
    // and cannot carry a golden hash.
    name: 'annotations/notes-in-nested-components',
    document: doc([
      {
        name: 'table',
        props: {
          columns: [
            {
              header: {
                content: {
                  name: 'paragraph',
                  props: {
                    text: 'Term[^col]',
                    footnotes: [{ id: 'col', text: 'Defined in clause 1.' }],
                  },
                },
              },
              cells: [
                {
                  content: {
                    name: 'paragraph',
                    props: {
                      text: 'The fee is 12%[^fee].',
                      footnotes: [
                        { id: 'fee', text: 'Per the amended schedule.' },
                      ],
                    },
                  },
                },
                {
                  content: {
                    name: 'paragraph',
                    props: {
                      text: 'Payable in arrears[^when].',
                      endnotes: [{ id: 'when', text: 'See Annex A.' }],
                    },
                  },
                },
              ],
            },
          ],
        },
      },
      {
        name: 'columns',
        props: { columns: 2, gap: 12 },
        children: [
          p({
            text: 'Column text with a note[^col2].',
            footnotes: [
              { id: 'col2', text: 'Registered from inside a column layout.' },
            ],
          }),
          p({ text: 'A second column with no notes.' }),
        ],
      },
      p({
        text: '- First item[^a]\n- Second item[^b]',
        footnotes: [
          { id: 'a', text: 'About the first item.' },
          { id: 'b', text: 'About the second item.' },
        ],
      }),
    ]),
  },

  // ==========================================================================
  // Tracked changes
  // ==========================================================================
  {
    // No author, no date: "json-to-office" and the epoch.
    name: 'annotations/revision-defaults',
    document: doc([
      p({
        text: 'The fee is 12% of revenue.',
        revision: {
          segments: [
            { type: 'equal', text: 'The fee is ' },
            { type: 'delete', text: '10%' },
            { type: 'insert', text: '12%' },
            { type: 'equal', text: ' of revenue.' },
          ],
        },
      }),
    ]),
  },
  {
    // Explicit authorship, and two authors in one document so the attribute
    // pair is pinned per revision rather than per document.
    name: 'annotations/revision-author-and-date',
    document: doc([
      p({
        text: 'The fee is 12% of revenue.',
        revision: {
          author: ADA,
          date: DATE_A,
          segments: [
            { type: 'equal', text: 'The fee is ' },
            { type: 'delete', text: '10%' },
            { type: 'insert', text: '12%' },
            { type: 'equal', text: ' of revenue.' },
          ],
        },
      }),
      p({
        text: 'Payment falls due within 30 days.',
        revision: {
          author: LEGAL,
          date: DATE_B,
          segments: [
            { type: 'equal', text: 'Payment falls due within ' },
            { type: 'delete', text: '45' },
            { type: 'insert', text: '30' },
            { type: 'equal', text: ' days.' },
          ],
        },
      }),
      p({
        text: 'An author with no date.',
        revision: {
          author: GRACE,
          segments: [{ type: 'insert', text: 'An author with no date.' }],
        },
      }),
    ]),
  },
  {
    // One paragraph per segment shape, plus the corners: empty segment text is
    // skipped entirely, whitespace-only text is not.
    name: 'annotations/revision-segment-kinds',
    document: doc([
      p({
        text: 'Wholly new sentence.',
        revision: {
          author: ADA,
          date: DATE_A,
          segments: [{ type: 'insert', text: 'Wholly new sentence.' }],
        },
      }),
      p({
        text: '',
        revision: {
          author: ADA,
          date: DATE_A,
          segments: [{ type: 'delete', text: 'Wholly removed sentence.' }],
        },
      }),
      p({
        text: 'Untouched sentence.',
        revision: {
          author: ADA,
          date: DATE_A,
          segments: [{ type: 'equal', text: 'Untouched sentence.' }],
        },
      }),
      p({
        text: 'Alternating changes throughout.',
        revision: {
          author: GRACE,
          date: DATE_B,
          segments: [
            { type: 'delete', text: 'Alternating ' },
            { type: 'insert', text: 'Interleaved ' },
            { type: 'equal', text: 'changes ' },
            { type: 'delete', text: 'everywhere' },
            { type: 'insert', text: 'throughout' },
            { type: 'equal', text: '.' },
          ],
        },
      }),
      p({
        text: 'Empty and blank segments.',
        revision: {
          author: GRACE,
          date: DATE_B,
          segments: [
            { type: 'equal', text: '' },
            { type: 'insert', text: '' },
            { type: 'equal', text: 'Empty' },
            { type: 'delete', text: '' },
            { type: 'insert', text: ' and' },
            { type: 'equal', text: ' ' },
            { type: 'equal', text: 'blank segments.' },
          ],
        },
      }),
    ]),
  },
  {
    // Newlines inside a segment become <w:br/> runs, one run per line, each
    // carrying its own revision id.
    name: 'annotations/revision-line-breaks',
    document: doc([
      p({
        text: 'Inserted line one\nInserted line two',
        revision: {
          author: ADA,
          date: DATE_A,
          segments: [
            { type: 'insert', text: 'Inserted line one\nInserted line two' },
            { type: 'equal', text: '\nUnchanged line three' },
            { type: 'delete', text: '\nDeleted line four\nDeleted line five' },
          ],
        },
      }),
    ]),
  },
  {
    // Segment text is rendered literally: markdown decorators stay as
    // characters. Placeholders are the exception — they resolve in `equal`
    // segments only, and stay literal inside a tracked change.
    name: 'annotations/revision-literal-markdown-and-placeholder',
    document: doc([
      p({
        text: 'Markdown in a revision stays literal.',
        revision: {
          author: ADA,
          date: DATE_A,
          segments: [
            { type: 'equal', text: 'Literal **bold** and ' },
            { type: 'delete', text: '*old italic*' },
            { type: 'insert', text: '__new underline__' },
            { type: 'equal', text: ' stay as written.' },
          ],
        },
      }),
      p({
        text: 'Placeholders resolve only outside the change.',
        revision: {
          author: GRACE,
          date: DATE_B,
          segments: [
            { type: 'equal', text: 'Page {PAGE} of {TOTAL_PAGES}: ' },
            { type: 'delete', text: 'page {PAGE} literal' },
            { type: 'insert', text: 'page {PAGE} literal too' },
          ],
        },
      }),
    ]),
  },
  {
    // A revised heading keeps its outline level and heading style; the runs
    // inside it are the tracked ones.
    name: 'annotations/revision-heading',
    document: doc([
      h({
        text: 'Revised Findings',
        level: 1,
        revision: {
          author: ADA,
          date: DATE_A,
          segments: [
            { type: 'delete', text: 'Draft Findings' },
            { type: 'insert', text: 'Revised Findings' },
          ],
        },
      }),
      h({
        text: 'Method',
        level: 2,
        revision: {
          author: GRACE,
          date: DATE_B,
          segments: [{ type: 'insert', text: 'Method' }],
        },
      }),
      p({ text: 'Body text under the revised headings.' }),
    ]),
  },
  {
    // List items carry their own revisions, including an item that is wholly
    // deleted — authored as empty text plus a delete segment.
    name: 'annotations/revision-list-items',
    document: doc([
      {
        name: 'list',
        props: {
          format: 'decimal',
          items: [
            { text: 'Unchanged first item', level: 0 },
            {
              text: '',
              level: 0,
              revision: {
                author: LEGAL,
                date: DATE_A,
                segments: [{ type: 'delete', text: 'Removed second item' }],
              },
            },
            {
              text: 'Added third item',
              level: 0,
              revision: {
                author: ADA,
                date: DATE_B,
                segments: [{ type: 'insert', text: 'Added third item' }],
              },
            },
            {
              text: 'Edited fourth item',
              level: 1,
              revision: {
                author: GRACE,
                date: DATE_C,
                segments: [
                  { type: 'equal', text: 'Edited ' },
                  { type: 'delete', text: 'third' },
                  { type: 'insert', text: 'fourth' },
                  { type: 'equal', text: ' item' },
                ],
              },
            },
          ],
        },
      },
    ]),
  },
  {
    // The paragraph's own style is the base style for every tracked run, so
    // font, colour, alignment and spacing all have to reach w:ins / w:del.
    name: 'annotations/revision-styled-paragraph',
    document: doc([
      p({
        text: 'Styled tracked text at 13pt.',
        font: {
          family: 'Georgia',
          size: 13,
          italic: true,
          color: '#334155',
          underline: true,
        },
        alignment: 'justify',
        spacing: { before: 9, after: 9 },
        indent: { left: 480, firstLine: 240 },
        language: 'en-GB',
        revision: {
          author: ADA,
          date: DATE_A,
          segments: [
            { type: 'equal', text: 'Styled tracked text at ' },
            { type: 'delete', text: '11pt' },
            { type: 'insert', text: '13pt' },
            { type: 'equal', text: '.' },
          ],
        },
      }),
    ]),
  },
  {
    // Comment ids and revision ids come from separate counters, so a paragraph
    // carrying both must not make either counter skip.
    name: 'annotations/revision-with-comment',
    document: doc([
      p({
        text: 'The fee is 12% of revenue.',
        revision: {
          author: ADA,
          date: DATE_A,
          segments: [
            { type: 'equal', text: 'The fee is ' },
            { type: 'delete', text: '10%' },
            { type: 'insert', text: '12%' },
            { type: 'equal', text: ' of revenue.' },
          ],
        },
        comment: {
          text: 'Raised per the amended schedule.',
          author: GRACE,
          initials: 'GH',
          date: DATE_B,
        },
      }),
      h({
        text: 'Amended terms',
        level: 2,
        revision: {
          author: ADA,
          date: DATE_A,
          segments: [
            { type: 'delete', text: 'Original terms' },
            { type: 'insert', text: 'Amended terms' },
          ],
        },
        comment: {
          text: 'Heading with both.',
          author: ADA,
          date: DATE_C,
          replies: [{ text: 'Noted.', author: GRACE, date: DATE_C }],
        },
      }),
    ]),
  },
  {
    // Structural marks on rows (w:trPr/w:ins | w:del) alongside text revisions
    // inside cells, including an unrevised row so the plain path stays pinned.
    name: 'annotations/revision-table-rows-and-cells',
    document: doc([
      {
        name: 'table',
        props: {
          columns: [
            {
              header: {
                content: 'Net tier',
                revision: {
                  author: ADA,
                  date: DATE_A,
                  segments: [
                    { type: 'delete', text: 'Gross tier' },
                    { type: 'insert', text: 'Net tier' },
                  ],
                },
              },
              cells: [
                { content: 'Basic' },
                { content: 'Legacy' },
                { content: 'Enterprise' },
                {
                  content: {
                    name: 'paragraph',
                    props: {
                      text: 'Bespoke',
                      revision: {
                        author: GRACE,
                        date: DATE_B,
                        segments: [
                          { type: 'delete', text: 'Custom' },
                          { type: 'insert', text: 'Bespoke' },
                        ],
                      },
                    },
                  },
                },
              ],
            },
            {
              header: { content: 'Price' },
              cells: [
                {
                  content: '25',
                  revision: {
                    author: ADA,
                    date: DATE_A,
                    segments: [
                      { type: 'delete', text: '20' },
                      { type: 'insert', text: '25' },
                    ],
                  },
                },
                { content: '15' },
                { content: '99' },
                { content: 'POA' },
              ],
            },
          ],
          rows: [
            {},
            { revision: { type: 'delete', author: LEGAL, date: DATE_A } },
            { revision: { type: 'insert', author: ADA, date: DATE_B } },
            // No author and no date: the defaults, on a structural mark.
            { revision: { type: 'insert' }, cantSplit: true },
          ],
        },
      },
    ]),
  },
  {
    // The document-level switch alone: nothing in the body is revised, so what
    // the hash pins is w:trackRevisions in settings.xml.
    name: 'annotations/track-revisions-setting',
    document: doc(
      [
        h({ text: 'Open for review', level: 1 }),
        p({
          text: 'Plain body text in a document opened in track-changes mode.',
        }),
      ],
      { trackRevisions: true }
    ),
  },
  {
    // The full redline shape: the switch on, tracked text, a structural row
    // change and a review comment in one document.
    name: 'annotations/track-revisions-redline',
    document: doc(
      [
        h({
          text: 'Schedule 2 (amended)',
          level: 1,
          revision: {
            author: LEGAL,
            date: DATE_A,
            segments: [
              { type: 'equal', text: 'Schedule 2 ' },
              { type: 'insert', text: '(amended)' },
            ],
          },
        }),
        p({
          text: 'The fee is 12% of revenue, payable within 30 days.',
          revision: {
            author: LEGAL,
            date: DATE_A,
            segments: [
              { type: 'equal', text: 'The fee is ' },
              { type: 'delete', text: '10%' },
              { type: 'insert', text: '12%' },
              { type: 'equal', text: ' of revenue, payable within ' },
              { type: 'delete', text: '45' },
              { type: 'insert', text: '30' },
              { type: 'equal', text: ' days.' },
            ],
          },
          comment: {
            text: 'Both changes agreed on the call.',
            author: ADA,
            initials: 'AL',
            date: DATE_B,
            replies: [{ text: 'Confirmed.', author: LEGAL, date: DATE_C }],
          },
        }),
        {
          name: 'table',
          props: {
            columns: [
              {
                header: { content: 'Clause' },
                cells: [{ content: '2.1' }, { content: '2.2' }],
              },
              {
                header: { content: 'Status' },
                cells: [{ content: 'Unchanged' }, { content: 'Struck out' }],
              },
            ],
            rows: [
              {},
              { revision: { type: 'delete', author: LEGAL, date: DATE_A } },
            ],
          },
        },
        p({
          text: 'Footnotes live on unrevised text[^src].',
          footnotes: [{ id: 'src', text: 'Agreed redline, version 3.' }],
        }),
      ],
      { trackRevisions: true }
    ),
  },
];
