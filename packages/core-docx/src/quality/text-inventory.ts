/**
 * Every string the document paints, with where it was written and what it
 * is — the authored side of the rendered pass's text matching (#344).
 *
 * The rendered PDF knows where each word landed and nothing about which
 * paragraph put it there. This inventory is the join key: a rendered finding
 * locates its words in the PDF, matches them back to one of these entries,
 * and reports at the entry's pointer. Walked over the expanded tree, so a
 * paragraph a block compiled is inventoried too; `prepareDocxQualityDocument`
 * then maps its pointer to the authored slot through the block source maps.
 *
 * An allowlist by component, unlike the placeholder walk that visits every
 * string: a colour, a style name or a file path is a string the page never
 * shows, and an entry the PDF cannot contain would read as clipped text.
 *
 * Two kinds of string are painted without being authored where they show.
 * A table of contents repeats the headings it collects — cached into the
 * field so headless LibreOffice shows them — and a native chart sets its
 * title and axis titles inside the drawing. Both are inventoried where they
 * render so a heading's first occurrence is not stolen by the contents page;
 * the contents entries are `optional`, since which headings a field collects
 * is the field's decision and an entry the page lacks is no defect.
 */

import type { QualityFact } from '@json-to-office/quality';

export type DocxTextRole =
  | 'heading'
  | 'body'
  | 'list-item'
  | 'table-header'
  | 'table-cell'
  | 'statistic'
  | 'caption'
  | 'toc-entry'
  | 'chrome';

export interface DocxTextFact extends QualityFact {
  kind: 'docx/text';
  text: string;
  role: DocxTextRole;
  /** Heading level, for `heading` entries. */
  level?: number;
  /** Position in reading order across the whole document, from 0. */
  order: number;
  /**
   * Set when the paragraph sits in a floating frame. Only the width is a
   * bound: a docx frame's height is a minimum the frame grows past, so the
   * rendered pass compares width alone.
   */
  frame?: { widthPt: number };
  /** Header or footer text repeats on every page of its section. */
  repeats?: boolean;
  /** Compiled by a block: `path` is the authored slot, not the paragraph. */
  generated?: boolean;
  /**
   * Painted by the renderer from other authored text — a contents entry —
   * so its absence is not a defect and never a `missing` finding.
   */
  optional?: boolean;
}

/** A `toc` component's outline range, as the field parses `props.depth`. */
function tocDepth(depth: unknown): { from: number; to: number } {
  const range = asRecord(depth) ?? {};
  const from = typeof range.from === 'number' ? range.from : 1;
  const to = typeof range.to === 'number' ? range.to : 3;
  return { from, to };
}

type Rec = Record<string, unknown>;

function asRecord(value: unknown): Rec | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Rec)
    : undefined;
}

/** Twips to points; `undefined` for anything that is not a finite number. */
function twipsToPt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value / 20
    : undefined;
}

/** A floating frame's declared width, in points, when it fixes one. */
function frameOf(props: Rec): DocxTextFact['frame'] | undefined {
  const widthPt = twipsToPt(asRecord(props.floating)?.width);
  return widthPt === undefined ? undefined : { widthPt };
}

/**
 * Inventory the text of a component tree in reading order. `basePath` is the
 * pointer of the array `children` sits at; entries carry pointers to the
 * exact string so a finding lands where the author can edit it.
 */
export function collectDocxTextInventory(
  children: readonly unknown[],
  basePath = '/children'
): DocxTextFact[] {
  const entries: DocxTextFact[] = [];
  const add = (
    path: string,
    text: unknown,
    role: DocxTextRole,
    extra: Partial<DocxTextFact> = {}
  ): void => {
    if (typeof text !== 'string' || text.trim() === '') return;
    entries.push({
      id: `docx:text:${path}`,
      kind: 'docx/text',
      path,
      text,
      role,
      // Renumbered once the walk is done: contents entries are spliced in.
      order: -1,
      ...extra,
    });
  };

  // Contents fields collect headings that come later in the walk, so they
  // are resolved after it: each `toc` remembers where in the inventory its
  // entries belong, every heading remembers which user section held it.
  interface Heading {
    text: string;
    /** Outline level; a style-mapped paragraph carries its theme style instead. */
    level?: number;
    themeStyle?: string;
    section: number | undefined;
  }
  interface Toc {
    /** Inventory index the entries are spliced in at. */
    at: number;
    path: string;
    depth: { from: number; to: number };
    /** Theme styles the field maps in as entries, whatever their level. */
    styles: ReadonlySet<string>;
    /** The user section to restrict to; undefined for the whole document. */
    section: number | undefined;
  }
  const headings: Heading[] = [];
  const tocs: Toc[] = [];
  let sectionCount = 0;

  // A header or cell is `{ content }`, where content is a string or a
  // component; a bare string is tolerated for the compiled forms that use it.
  interface Inherited {
    repeats?: boolean;
    /** Ordinal of the enclosing user `section`, for contents scoping. */
    section?: number;
    /** Inside a table cell, which the contents field never collects from. */
    inCell?: boolean;
  }

  const visitCell = (
    cell: unknown,
    path: string,
    role: DocxTextRole,
    inherited: Inherited
  ): void => {
    // A footer is often a borderless table. Its cells repeat on every page
    // like any other chrome, so the role and the repeat flag have to survive
    // the descent — otherwise the text is matched once, as body copy.
    const cellRole = inherited.repeats ? 'chrome' : role;
    const extra = inherited.repeats ? { repeats: true as const } : {};
    if (typeof cell === 'string') {
      add(path, cell, cellRole, extra);
      return;
    }
    const rec = asRecord(cell);
    if (!rec) return;
    if ('content' in rec) {
      if (typeof rec.content === 'string')
        add(`${path}/content`, rec.content, cellRole, extra);
      else {
        const inner = asRecord(rec.content);
        if (inner)
          visitNode(inner, `${path}/content`, { ...inherited, inCell: true });
      }
      return;
    }
    if (typeof rec.name === 'string')
      visitNode(rec, path, { ...inherited, inCell: true });
  };

  const visitNode = (node: Rec, path: string, inherited: Inherited): void => {
    if (node.enabled === false) return;
    const props = asRecord(node.props) ?? {};
    const name = typeof node.name === 'string' ? node.name : '';
    const extra: Partial<DocxTextFact> = {
      ...(inherited.repeats && { repeats: true }),
    };
    // Children of a user section carry its ordinal, for contents scoping.
    const scope: Inherited =
      name === 'section'
        ? { ...inherited, section: ++sectionCount }
        : inherited;

    switch (name) {
      case 'heading': {
        // A heading inside a running header or footer is chrome, not a
        // document heading: it repeats on every page, and the rendered pass
        // would otherwise read it as a heading stranded at the page foot.
        if (inherited.repeats) {
          add(`${path}/props/text`, props.text, 'chrome', extra);
          break;
        }
        const level =
          typeof props.level === 'number' && Number.isFinite(props.level)
            ? props.level
            : 1;
        add(`${path}/props/text`, props.text, 'heading', { ...extra, level });
        if (
          typeof props.text === 'string' &&
          props.text.trim() !== '' &&
          !scope.inCell
        ) {
          headings.push({ text: props.text, level, section: scope.section });
        }
        break;
      }
      case 'toc': {
        // The title is a plain paragraph the field carries; the entries
        // come after the walk. `auto` scope is the section when the field
        // sits in a user section, the document otherwise — as the compiler
        // resolves it.
        add(`${path}/props/title`, props.title, 'toc-entry', extra);
        const styles = new Set<string>();
        if (Array.isArray(props.styles)) {
          for (const mapping of props.styles) {
            const id = asRecord(mapping)?.styleId;
            if (typeof id === 'string') styles.add(id);
          }
        }
        tocs.push({
          at: entries.length,
          path,
          depth: tocDepth(props.depth),
          styles,
          section: props.scope === 'document' ? undefined : scope.section,
        });
        break;
      }
      case 'paragraph': {
        const frame = frameOf(props);
        add(
          `${path}/props/text`,
          props.text,
          inherited.repeats ? 'chrome' : 'body',
          {
            ...extra,
            ...(frame && { frame }),
          }
        );
        if (
          typeof props.themeStyle === 'string' &&
          typeof props.text === 'string' &&
          props.text.trim() !== '' &&
          !scope.inCell
        ) {
          headings.push({
            text: props.text,
            themeStyle: props.themeStyle,
            section: scope.section,
          });
        }
        break;
      }
      case 'list': {
        if (Array.isArray(props.items)) {
          props.items.forEach((item, index) => {
            const itemPath = `${path}/props/items/${index}`;
            if (typeof item === 'string')
              add(itemPath, item, 'list-item', extra);
            else {
              const rec = asRecord(item);
              if (rec) add(`${itemPath}/text`, rec.text, 'list-item', extra);
            }
          });
        }
        break;
      }
      case 'table': {
        // The model is column-major; the page is read row by row, and so is
        // the inventory, or a duplicate cell string lands on the wrong cell.
        const columns = Array.isArray(props.columns)
          ? props.columns.map(asRecord)
          : [];
        columns.forEach((column, columnIndex) => {
          if (!column) return;
          visitCell(
            column.header,
            `${path}/props/columns/${columnIndex}/header`,
            'table-header',
            inherited
          );
        });
        const rows = Math.max(
          0,
          ...columns.map((column) =>
            Array.isArray(column?.cells) ? column.cells.length : 0
          )
        );
        for (let row = 0; row < rows; row++) {
          columns.forEach((column, columnIndex) => {
            if (!column || !Array.isArray(column.cells)) return;
            if (row >= column.cells.length) return;
            visitCell(
              column.cells[row],
              `${path}/props/columns/${columnIndex}/cells/${row}`,
              'table-cell',
              inherited
            );
          });
        }
        break;
      }
      case 'statistic': {
        add(`${path}/props/number`, props.number, 'statistic', extra);
        add(`${path}/props/description`, props.description, 'statistic', extra);
        break;
      }
      case 'chart': {
        // A native chart draws its title and axis titles as text the PDF
        // carries — the title unless `showTitle` hides it, the axis titles
        // only where the chart has axes. Series names and category labels
        // it may abbreviate, so those stay out.
        if (props.showTitle !== false) {
          add(`${path}/props/title`, props.title, 'caption', extra);
        }
        if (props.type !== 'pie' && props.type !== 'doughnut') {
          add(
            `${path}/props/catAxisTitle`,
            props.catAxisTitle,
            'caption',
            extra
          );
          add(
            `${path}/props/valAxisTitle`,
            props.valAxisTitle,
            'caption',
            extra
          );
        }
        add(`${path}/props/caption`, props.caption, 'caption', extra);
        break;
      }
      case 'image':
      case 'highcharts':
      case 'visual':
      case 'visual-native': {
        add(`${path}/props/caption`, props.caption, 'caption', extra);
        break;
      }
      case 'section': {
        for (const part of ['header', 'footer'] as const) {
          const components = props[part];
          if (!Array.isArray(components)) continue;
          components.forEach((component, index) => {
            const rec = asRecord(component);
            if (rec) {
              visitNode(rec, `${path}/props/${part}/${index}`, {
                repeats: true,
              });
            }
          });
        }
        break;
      }
      default:
        break;
    }

    if (Array.isArray(node.children)) {
      node.children.forEach((child, index) => {
        const rec = asRecord(child);
        if (rec) visitNode(rec, `${path}/children/${index}`, scope);
      });
    }
  };

  children.forEach((child, index) => {
    const rec = asRecord(child);
    if (rec) visitNode(rec, `${basePath}/${index}`, {});
  });

  // Splice contents entries in, last field first so earlier indices hold,
  // then renumber: reading order is the whole point of the inventory.
  for (const toc of [...tocs].reverse()) {
    // Headings within the outline range, plus every paragraph whose theme
    // style the field maps — those enter whatever the range says.
    const collected = headings.filter(
      (heading) =>
        (toc.section === undefined || heading.section === toc.section) &&
        (heading.level !== undefined
          ? heading.level >= toc.depth.from && heading.level <= toc.depth.to
          : heading.themeStyle !== undefined &&
            toc.styles.has(heading.themeStyle))
    );
    entries.splice(
      toc.at,
      0,
      ...collected.map(
        (heading, index): DocxTextFact => ({
          id: `docx:text:${toc.path}:entry:${index}`,
          kind: 'docx/text',
          path: toc.path,
          text: heading.text,
          role: 'toc-entry',
          order: 0,
          optional: true,
        })
      )
    );
  }
  entries.forEach((entry, index) => {
    entry.order = index;
  });
  return entries;
}
