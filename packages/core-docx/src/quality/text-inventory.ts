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
  | 'chrome';

export interface DocxTextFact extends QualityFact {
  kind: 'docx/text';
  text: string;
  role: DocxTextRole;
  /** Heading level, for `heading` entries. */
  level?: number;
  /** Position in reading order across the whole document, from 0. */
  order: number;
  /** Set when the paragraph sits in a floating frame with fixed geometry. */
  frame?: {
    xPt?: number;
    yPt?: number;
    widthPt: number;
    heightPt?: number;
  };
  /** Header or footer text repeats on every page of its section. */
  repeats?: boolean;
  /** Compiled by a block: `path` is the authored slot, not the paragraph. */
  generated?: boolean;
}

type Rec = Record<string, unknown>;

function asRecord(value: unknown): Rec | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Rec)
    : undefined;
}

function pointerSegment(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

function twipsToPt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value / 20
    : undefined;
}

/** A floating frame's declared box, in points, when it fixes a width. */
function frameOf(props: Rec): DocxTextFact['frame'] | undefined {
  const floating = asRecord(props.floating);
  if (!floating) return undefined;
  const widthPt = twipsToPt(floating.width);
  if (widthPt === undefined) return undefined;
  const heightPt = twipsToPt(floating.height);
  const xPt = twipsToPt(asRecord(floating.horizontalPosition)?.offset);
  const yPt = twipsToPt(asRecord(floating.verticalPosition)?.offset);
  return {
    widthPt,
    ...(heightPt !== undefined && { heightPt }),
    ...(xPt !== undefined && { xPt }),
    ...(yPt !== undefined && { yPt }),
  };
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
      order: entries.length,
      ...extra,
    });
  };

  // A header or cell is `{ content }`, where content is a string or a
  // component; a bare string is tolerated for the compiled forms that use it.
  const visitCell = (cell: unknown, path: string, role: DocxTextRole): void => {
    if (typeof cell === 'string') {
      add(path, cell, role);
      return;
    }
    const rec = asRecord(cell);
    if (!rec) return;
    if ('content' in rec) {
      if (typeof rec.content === 'string')
        add(`${path}/content`, rec.content, role);
      else {
        const inner = asRecord(rec.content);
        if (inner) visitNode(inner, `${path}/content`, {});
      }
      return;
    }
    if (typeof rec.name === 'string') visitNode(rec, path, {});
  };

  const visitNode = (
    node: Rec,
    path: string,
    inherited: { repeats?: boolean }
  ): void => {
    if (node.enabled === false) return;
    const props = asRecord(node.props) ?? {};
    const name = typeof node.name === 'string' ? node.name : '';
    const extra: Partial<DocxTextFact> = {
      ...(inherited.repeats && { repeats: true }),
    };

    switch (name) {
      case 'heading': {
        const level =
          typeof props.level === 'number' && Number.isFinite(props.level)
            ? props.level
            : 1;
        add(`${path}/props/text`, props.text, 'heading', { ...extra, level });
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
        if (Array.isArray(props.columns)) {
          props.columns.forEach((column, columnIndex) => {
            const rec = asRecord(column);
            if (!rec) return;
            const columnPath = `${path}/props/columns/${columnIndex}`;
            visitCell(rec.header, `${columnPath}/header`, 'table-header');
          });
          props.columns.forEach((column, columnIndex) => {
            const rec = asRecord(column);
            if (!rec || !Array.isArray(rec.cells)) return;
            const columnPath = `${path}/props/columns/${columnIndex}`;
            rec.cells.forEach((cell, cellIndex) =>
              visitCell(cell, `${columnPath}/cells/${cellIndex}`, 'table-cell')
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
      case 'image':
      case 'chart':
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
        if (rec) visitNode(rec, `${path}/children/${index}`, inherited);
      });
    }
  };

  children.forEach((child, index) => {
    const rec = asRecord(child);
    if (rec) visitNode(rec, `${basePath}/${pointerSegment(String(index))}`, {});
  });
  return entries;
}
