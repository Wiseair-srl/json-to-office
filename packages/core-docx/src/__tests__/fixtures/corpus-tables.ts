/**
 * DOCX parity corpus — tables.
 *
 * The `table` component is column-major: `columns[]` carries the header cell
 * and the whole column of body cells, and anything that belongs to a row
 * instead of a column lives in the row-parallel `rows[]` array. Styling
 * cascades through four levels — table `cellDefaults` / `headerCellDefaults`,
 * column `cellDefaults`, then the cell itself — and borders, sizes and padding
 * merge per side rather than wholesale. Most of the cases below exist to pin
 * one rung of that cascade, or one branch of the width/border resolution, so a
 * changed hash names the thing that moved.
 *
 * Two features the brief asked about are absent from the schema and so cannot
 * be covered: there is no `colSpan` / `rowSpan` (no cell merging at all), and
 * there is no banded/striped table style — banding is authored by hand, one
 * `backgroundColor` per cell, which `tables/zebra-banding` does.
 */

import type { CorpusCase } from './corpus-types';

/** A 4x2 PNG, small enough to inline and big enough to have an aspect ratio. */
const PNG_4X2 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAABytg0kAAAAFElEQVR42mNk+M9QzwAFjDAGACPuA/8fMSCgAAAAAElFTkSuQmCC';

const doc = (children: unknown[]): unknown => ({
  name: 'docx',
  props: {
    theme: 'minimal',
    metadata: { title: 'Corpus', author: 'JTO' },
  },
  children,
});

/** A document holding exactly one table, which is the usual shape here. */
const tableDoc = (props: Record<string, unknown>): unknown =>
  doc([{ name: 'table', props }]);

/** `columns[]` entries from parallel arrays of plain strings. */
const stringColumns = (
  headers: string[],
  rows: string[][]
): Record<string, unknown>[] =>
  headers.map((header, col) => ({
    header: { content: header },
    cells: rows.map((row) => ({ content: row[col] ?? '' })),
  }));

export const CASES: CorpusCase[] = [
  // --- structure ----------------------------------------------------------
  {
    name: 'tables/minimal',
    document: tableDoc({
      columns: [{ header: { content: 'Only' }, cells: [{ content: 'Cell' }] }],
    }),
  },
  {
    name: 'tables/header-and-rows',
    document: tableDoc({
      columns: stringColumns(
        ['Region', 'Sensors', 'Uptime'],
        [
          ['North', '12', '99.4%'],
          ['South', '8', '98.1%'],
          ['East', '15', '99.9%'],
        ]
      ),
    }),
  },
  {
    name: 'tables/header-only-no-rows',
    // `numRows` is 0, so the header row is also the last row and picks up the
    // table's bottom outer border.
    document: tableDoc({
      borderColor: '333333',
      borderSize: 2,
      columns: [
        { header: { content: 'Field' } },
        { header: { content: 'Type' } },
      ],
    }),
  },
  {
    name: 'tables/cells-without-header',
    // No `header` key anywhere: the header row still renders, empty.
    document: tableDoc({
      columns: [
        { cells: [{ content: 'a1' }, { content: 'a2' }] },
        { cells: [{ content: 'b1' }, { content: 'b2' }] },
      ],
    }),
  },
  {
    name: 'tables/ragged-and-empty-cells',
    // Row count comes from the first column, so the shorter columns exercise
    // the missing-cell branch; `content: ''` and an omitted `content` are two
    // different empty cells.
    document: tableDoc({
      columns: [
        {
          header: { content: 'Full' },
          cells: [
            { content: 'r1' },
            { content: 'r2' },
            { content: 'r3' },
            { content: 'r4' },
          ],
        },
        {
          header: { content: 'Short' },
          cells: [{ content: '' }, {}, { content: 'r3' }],
        },
        { header: { content: 'Absent' } },
        { header: {}, cells: [{ content: 'only' }] },
      ],
    }),
  },
  {
    name: 'tables/many-columns-even-split',
    document: tableDoc({
      columns: stringColumns(
        ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
        [
          ['1', '2', '3', '4', '5', '6', '7', '8'],
          ['9', '10', '11', '12', '13', '14', '15', '16'],
        ]
      ),
    }),
  },

  // --- widths -------------------------------------------------------------
  {
    name: 'tables/column-widths-points',
    // Every column explicit: the table switches from percentage to DXA.
    document: tableDoc({
      columns: [
        { width: 120, header: { content: 'Wide' }, cells: [{ content: 'w' }] },
        { width: 60, header: { content: 'Narrow' }, cells: [{ content: 'n' }] },
        { width: 90, header: { content: 'Mid' }, cells: [{ content: 'm' }] },
      ],
    }),
  },
  {
    name: 'tables/column-widths-percent',
    document: tableDoc({
      columns: [
        {
          width: '50%',
          header: { content: 'Half' },
          cells: [{ content: 'h' }],
        },
        {
          width: '25%',
          header: { content: 'Quarter' },
          cells: [{ content: 'q' }],
        },
        {
          width: '24.5%',
          header: { content: 'Fraction' },
          cells: [{ content: 'f' }],
        },
      ],
    }),
  },
  {
    name: 'tables/column-widths-partial',
    // Only some columns are sized; the rest share the leftover space equally.
    document: tableDoc({
      columns: [
        { width: 150, header: { content: 'Fixed' }, cells: [{ content: 'a' }] },
        { header: { content: 'Auto 1' }, cells: [{ content: 'b' }] },
        { header: { content: 'Auto 2' }, cells: [{ content: 'c' }] },
        { width: '20%', header: { content: 'Pct' }, cells: [{ content: 'd' }] },
      ],
    }),
  },
  {
    name: 'tables/table-width-percentage',
    // `width` only applies on the percentage path, i.e. with no column widths.
    document: tableDoc({
      width: 60,
      columns: stringColumns(
        ['Key', 'Value'],
        [
          ['alpha', '1'],
          ['beta', '2'],
        ]
      ),
    }),
  },
  {
    name: 'tables/table-width-with-explicit-columns',
    // `width` is ignored once any column is explicitly sized.
    document: tableDoc({
      width: 40,
      columns: [
        { width: 100, header: { content: 'One' }, cells: [{ content: '1' }] },
        { width: 100, header: { content: 'Two' }, cells: [{ content: '2' }] },
      ],
    }),
  },

  // --- heights ------------------------------------------------------------
  {
    name: 'tables/row-and-cell-heights',
    // Row height is the max of any cell that declares one, and header height
    // is computed the same way over the header cells.
    document: tableDoc({
      cellDefaults: { height: 20 },
      headerCellDefaults: { height: 34 },
      columns: [
        {
          header: { content: 'Default height' },
          cells: [{ content: 'inherits 20' }, { content: 'tall', height: 72 }],
        },
        {
          cellDefaults: { height: 44 },
          header: { content: 'Column height', height: 50 },
          cells: [{ content: 'inherits 44' }, { content: 'inherits 44' }],
        },
      ],
    }),
  },

  // --- borders ------------------------------------------------------------
  {
    name: 'tables/borders-uniform',
    document: tableDoc({
      borderColor: '2C3E50',
      borderSize: 2,
      columns: stringColumns(
        ['Left', 'Right'],
        [
          ['a', 'b'],
          ['c', 'd'],
        ]
      ),
    }),
  },
  {
    name: 'tables/borders-per-side',
    // Per-side objects at all three levels; omitted sides fall through to the
    // next level down rather than resetting to the default.
    document: tableDoc({
      borderColor: { top: 'FF0000', bottom: '0000FF' },
      borderSize: { top: 3, bottom: 3 },
      cellDefaults: {
        borderColor: { left: '00AA00', right: '00AA00' },
        borderSize: { left: 1, right: 1 },
      },
      columns: [
        {
          cellDefaults: { borderColor: { top: 'AAAAAA' } },
          header: { content: 'Column override' },
          cells: [
            { content: 'inherits' },
            {
              content: 'cell override',
              borderColor: { bottom: 'FF00FF' },
              borderSize: { bottom: 4 },
            },
          ],
        },
        {
          header: { content: 'Plain', borderSize: 2 },
          cells: [{ content: 'x' }, { content: 'y' }],
        },
      ],
    }),
  },
  {
    name: 'tables/borders-zero-size',
    // Size 0 renders as BorderStyle.NONE, which is a different route to an
    // invisible border than `hideBorders`.
    document: tableDoc({
      borderSize: 0,
      columns: [
        {
          header: { content: 'No borders' },
          cells: [{ content: 'a' }, { content: 'b', borderSize: { top: 2 } }],
        },
        {
          cellDefaults: { borderSize: { left: 0, right: 0 } },
          header: { content: 'Mixed' },
          cells: [{ content: 'c' }, { content: 'd' }],
        },
      ],
    }),
  },
  {
    name: 'tables/hide-borders-all',
    document: tableDoc({
      hideBorders: true,
      borderColor: '000000',
      borderSize: 2,
      columns: stringColumns(
        ['Silent', 'Rows'],
        [
          ['a', 'b'],
          ['c', 'd'],
        ]
      ),
    }),
  },
  {
    name: 'tables/hide-borders-selective',
    // Outer sides and the two inside directions are separately switchable.
    document: tableDoc({
      borderColor: 'D6DAE0',
      borderSize: 1,
      hideBorders: {
        top: true,
        left: true,
        insideVertical: true,
        insideHorizontal: false,
        bottom: false,
        right: false,
      },
      columns: stringColumns(
        ['One', 'Two', 'Three'],
        [
          ['a', 'b', 'c'],
          ['d', 'e', 'f'],
          ['g', 'h', 'i'],
        ]
      ),
    }),
  },

  // --- shading ------------------------------------------------------------
  {
    name: 'tables/shading-levels',
    // Hex, theme color name, and the "transparent" sentinel that suppresses
    // the shading element altogether, one at each level of the cascade.
    document: tableDoc({
      cellDefaults: { backgroundColor: '#FAFAFA' },
      headerCellDefaults: { backgroundColor: 'accent', color: '#FFFFFF' },
      columns: [
        {
          header: { content: 'Inherited' },
          cells: [
            { content: 'table default' },
            { content: 'transparent', backgroundColor: 'transparent' },
          ],
        },
        {
          cellDefaults: { backgroundColor: 'backgroundSecondary' },
          header: { content: 'Theme name' },
          cells: [
            { content: 'column default' },
            { content: 'cell override', backgroundColor: '#FFE9B0' },
          ],
        },
        {
          header: { content: 'Header override', backgroundColor: '#333333' },
          cells: [{ content: 'a' }, { content: 'b' }],
        },
      ],
    }),
  },
  {
    name: 'tables/zebra-banding',
    // The schema has no banded style, so alternating fills are per cell.
    document: tableDoc({
      hideBorders: { insideVertical: true },
      headerCellDefaults: {
        backgroundColor: '#2C3E50',
        color: '#FFFFFF',
        font: { bold: true },
      },
      columns: ['Item', 'Qty', 'Price'].map((header, col) => ({
        header: { content: header },
        cells: [
          ['Bolt', '120', '0.10'],
          ['Nut', '240', '0.05'],
          ['Washer', '480', '0.02'],
          ['Screw', '60', '0.15'],
        ].map((row, rowIndex) => ({
          content: row[col],
          backgroundColor: rowIndex % 2 === 0 ? '#F5F7FA' : 'transparent',
        })),
      })),
    }),
  },

  // --- alignment and spacing ---------------------------------------------
  {
    name: 'tables/alignment-matrix',
    // Every horizontal value against every vertical value.
    document: tableDoc({
      cellDefaults: { height: 60 },
      columns: (['left', 'center', 'right', 'justify'] as const).map(
        (horizontalAlignment) => ({
          cellDefaults: { horizontalAlignment },
          header: { content: horizontalAlignment, verticalAlignment: 'bottom' },
          cells: (['top', 'middle', 'bottom'] as const).map(
            (verticalAlignment) => ({
              content: `${horizontalAlignment} / ${verticalAlignment}`,
              verticalAlignment,
            })
          ),
        })
      ),
    }),
  },
  {
    name: 'tables/cell-padding',
    // Scalar padding, full per-side padding, and a partial object whose
    // omitted sides come from the level above.
    document: tableDoc({
      cellDefaults: { padding: { top: 4, right: 10, bottom: 4, left: 10 } },
      headerCellDefaults: { padding: 12 },
      columns: [
        {
          header: { content: 'Table padding' },
          cells: [{ content: 'inherits' }, { content: 'inherits' }],
        },
        {
          cellDefaults: { padding: 2 },
          header: { content: 'Column padding' },
          cells: [
            { content: 'column' },
            { content: 'cell', padding: { top: 20, left: 30 } },
          ],
        },
      ],
    }),
  },

  // --- typography ---------------------------------------------------------
  {
    name: 'tables/cell-fonts',
    document: tableDoc({
      cellDefaults: { font: { family: 'Georgia', size: 10 }, color: '#2C2C2C' },
      headerCellDefaults: {
        font: { family: 'Arial', size: 11, bold: true, underline: true },
      },
      columns: [
        {
          header: { content: 'Inherited' },
          cells: [
            { content: 'Georgia 10' },
            { content: 'italic', font: { italic: true } },
          ],
        },
        {
          cellDefaults: { font: { family: 'Consolas', size: 9 } },
          header: { content: 'Monospace' },
          cells: [
            { content: 'GET /things' },
            {
              content: 'weighted',
              font: { fontWeight: 300 },
              color: 'secondary',
            },
          ],
        },
        {
          header: { content: 'Cell overrides' },
          cells: [
            {
              content: 'big bold',
              font: { size: 16, bold: true },
              color: '#B00020',
            },
            {
              content: 'weight wins over bold',
              font: { bold: true, fontWeight: 900 },
            },
          ],
        },
      ],
    }),
  },
  {
    name: 'tables/defaults-cascade',
    // One property overridden at each rung, so a change in precedence shows up
    // as a change to exactly this hash.
    document: tableDoc({
      borderColor: 'CCCCCC',
      borderSize: 1,
      cellDefaults: {
        color: '#111111',
        backgroundColor: '#FFFFFF',
        horizontalAlignment: 'left',
        verticalAlignment: 'top',
        font: { family: 'Arial', size: 10, bold: false },
        padding: 6,
      },
      headerCellDefaults: {
        color: '#FFFFFF',
        backgroundColor: '#111111',
        horizontalAlignment: 'center',
        font: { bold: true },
      },
      columns: [
        {
          cellDefaults: {
            horizontalAlignment: 'right',
            font: { italic: true },
            padding: 3,
          },
          header: { content: 'Column beats table' },
          cells: [{ content: 'column wins' }],
        },
        {
          cellDefaults: { color: '#0057B8' },
          header: {
            content: 'Cell beats column',
            horizontalAlignment: 'left',
            color: '#FFCC00',
          },
          cells: [
            {
              content: 'cell wins',
              color: '#B00020',
              horizontalAlignment: 'center',
              verticalAlignment: 'bottom',
              font: { size: 14 },
              padding: { left: 24 },
            },
          ],
        },
      ],
    }),
  },

  // --- cell content -------------------------------------------------------
  {
    name: 'tables/nested-paragraphs',
    // A paragraph component in a cell layers its own font over the merged cell
    // style, and keeps its alignment/spacing props.
    document: tableDoc({
      cellDefaults: { font: { family: 'Georgia', size: 10 } },
      columns: [
        {
          header: {
            content: {
              name: 'paragraph',
              props: { text: 'Rich header', font: { bold: true, size: 12 } },
            },
          },
          cells: [
            {
              content: {
                name: 'paragraph',
                props: {
                  text: 'Paragraph with **bold** and *italic*',
                  alignment: 'center',
                  spacing: { before: 6, after: 6 },
                },
              },
            },
            {
              content: {
                name: 'paragraph',
                props: {
                  text: 'Coloured override',
                  font: {
                    family: 'Arial',
                    size: 8,
                    color: '#B00020',
                    italic: true,
                    underline: true,
                  },
                },
              },
            },
          ],
        },
        {
          header: { content: 'Plain string header' },
          cells: [{ content: 'plain string' }, { content: 'plain string' }],
        },
      ],
    }),
  },
  {
    name: 'tables/nested-image',
    document: tableDoc({
      columns: [
        {
          width: 120,
          header: { content: 'Logo' },
          cells: [
            {
              content: {
                name: 'image',
                props: { base64: PNG_4X2, width: 48 },
              },
            },
            {
              // Height only: the width follows from the aspect ratio.
              content: {
                name: 'image',
                props: { base64: PNG_4X2, height: 24 },
              },
            },
          ],
        },
        {
          header: { content: 'Caption' },
          cells: [
            { content: 'sized by width' },
            { content: 'sized by height' },
          ],
        },
      ],
    }),
  },
  {
    name: 'tables/cell-text-decorators',
    // Cell strings go through the same decorator parser paragraphs use, and an
    // unregistered {placeholder} passes through untouched. No markdown link:
    // external hyperlinks get a fresh relationship id on every build, so any
    // document containing one is not byte-stable and cannot be hashed.
    document: tableDoc({
      columns: [
        {
          header: { content: '**Bold header**' },
          cells: [
            { content: 'plain, **bold**, *italic*, ***both***' },
            { content: 'underscores __bold__ and _italic_' },
            { content: 'placeholder {resource} stays literal' },
            { content: 'line one\nline two' },
          ],
        },
      ],
    }),
  },
  {
    name: 'tables/unsupported-nested-component',
    // A component the cell renderer does not handle falls back to a
    // placeholder run rather than throwing.
    document: tableDoc({
      columns: [
        {
          header: { content: 'Kind' },
          cells: [{ content: 'list' }, { content: 'heading' }],
        },
        {
          header: { content: 'Rendered as' },
          cells: [
            { content: { name: 'list', props: { items: ['a', 'b'] } } },
            { content: { name: 'heading', props: { text: 'Nope', level: 2 } } },
          ],
        },
      ],
    }),
  },

  // --- pagination and row-parallel props ----------------------------------
  {
    name: 'tables/pagination-flags',
    document: tableDoc({
      keepInOnePage: true,
      keepNext: true,
      repeatHeaderOnPageBreak: false,
      columns: stringColumns(
        ['Step', 'Owner'],
        [
          ['Draft', 'A'],
          ['Review', 'B'],
          ['Publish', 'C'],
        ]
      ),
    }),
  },
  {
    name: 'tables/row-properties',
    // `rows[]` is indexed like `columns[].cells`, so these land on rows 0 and 2.
    document: tableDoc({
      rows: [
        { cantSplit: true },
        {},
        { tableHeader: true, cantSplit: false },
        { tableHeader: false },
      ],
      columns: stringColumns(
        ['Label', 'Value'],
        [
          ['kept together', '1'],
          ['default', '2'],
          ['repeats as header', '3'],
          ['explicitly not a header', '4'],
        ]
      ),
    }),
  },
  {
    name: 'tables/row-revisions',
    // A structural mark on the row also marks every cell's runs and paragraph
    // marks, so an accepted deletion removes the row rather than emptying it.
    document: tableDoc({
      rows: [
        {},
        { revision: { type: 'insert', author: 'Reviewer' } },
        { revision: { type: 'delete', author: 'Reviewer' } },
      ],
      columns: stringColumns(
        ['Clause', 'Status'],
        [
          ['Unchanged', 'kept'],
          ['Added clause', 'inserted'],
          ['Removed clause', 'deleted'],
        ]
      ),
    }),
  },
  {
    name: 'tables/cell-comment-and-revision',
    // Comments and text revisions are cell-level props, and a comment on an
    // empty cell still has to anchor somewhere.
    document: tableDoc({
      columns: [
        {
          header: {
            content: 'Reviewed',
            comment: { text: 'Header comment', author: 'Reviewer' },
          },
          cells: [
            {
              content: 'Commented cell',
              comment: {
                text: 'First note',
                author: 'Reviewer',
                initials: 'RV',
                replies: [{ text: 'Agreed', author: 'Author' }],
                resolved: true,
              },
            },
            { comment: { text: 'Note on an empty cell', author: 'Reviewer' } },
          ],
        },
        {
          header: { content: 'Redlined' },
          cells: [
            {
              content: 'Updated wording',
              revision: {
                author: 'Reviewer',
                segments: [
                  { type: 'equal', text: 'The ' },
                  { type: 'delete', text: 'old' },
                  { type: 'insert', text: 'new' },
                  { type: 'equal', text: ' wording' },
                ],
              },
            },
            { content: 'Untouched' },
          ],
        },
      ],
    }),
  },

  // --- interaction with the surrounding document --------------------------
  {
    name: 'tables/adjacent-tables',
    // Two tables back to back, plus one after a paragraph: table-level state
    // must not leak from one to the next.
    document: doc([
      { name: 'paragraph', props: { text: 'Before.' } },
      {
        name: 'table',
        props: {
          borderColor: 'FF0000',
          columns: stringColumns(['First'], [['a'], ['b']]),
        },
      },
      {
        name: 'table',
        props: {
          hideBorders: true,
          width: 50,
          columns: stringColumns(['Second'], [['c']]),
        },
      },
      { name: 'paragraph', props: { text: 'Between.' } },
      {
        name: 'table',
        props: {
          columns: [
            {
              width: 200,
              header: { content: 'Third' },
              cells: [{ content: 'd' }],
            },
          ],
        },
      },
    ]),
  },
];
