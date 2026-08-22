/**
 * DocxIR invariants.
 *
 * Not authoring checks — the schema validators already ran. These guard the
 * contract the IR promises adapters: resolved colours, integral twip geometry,
 * resolved resource and style references, paired bookmark and comment ranges,
 * note references that point at a note that exists.
 *
 * A violation is a compiler bug, so it is an error, not a warning.
 */

import { assertNever } from '@json-to-office/shared/rendering';
import {
  DOCX_IR_SCHEMA_VERSION,
  type DocxIR,
  type DocxIrBlock,
  type DocxIrColor,
  type DocxIrInline,
  type DocxIrParagraphFormatting,
  type DocxIrRunFormatting,
} from './types';

export interface IrViolation {
  path: string;
  message: string;
}

const HEX6 = /^[0-9A-F]{6}$/;

interface Scope {
  ir: DocxIR;
  resourceIds: ReadonlySet<string>;
  styleIds: ReadonlySet<string>;
  numberingRefs: ReadonlySet<string>;
  footnoteIds: ReadonlySet<number>;
  endnoteIds: ReadonlySet<number>;
  commentIds: ReadonlySet<number>;
  add: (path: string, message: string) => void;
  /** Bookmark ids opened but not yet closed, for pairing. */
  openBookmarks: Map<number, string>;
  openComments: Set<number>;
}

export function validateDocxIr(ir: DocxIR): IrViolation[] {
  const violations: IrViolation[] = [];
  const add = (path: string, message: string) =>
    violations.push({ path, message });

  if (ir.schemaVersion !== DOCX_IR_SCHEMA_VERSION) {
    add(
      'schemaVersion',
      `expected ${DOCX_IR_SCHEMA_VERSION}, got ${ir.schemaVersion}`
    );
  }

  const resourceIds = new Set<string>();
  ir.resources.forEach((resource, index) => {
    const path = `resources[${index}]`;
    if (resourceIds.has(resource.id)) {
      add(path, `duplicate resource id "${resource.id}"`);
    }
    resourceIds.add(resource.id);
    if (resource.bytes.byteLength !== resource.byteLength) {
      add(path, 'byteLength does not match bytes');
    }
    if (!/^[0-9a-f]{64}$/.test(resource.sha256)) {
      add(`${path}.sha256`, 'expected a lowercase hex SHA-256');
    }
  });
  for (const [index, resource] of ir.resources.entries()) {
    if (
      resource.fallbackResourceId &&
      !resourceIds.has(resource.fallbackResourceId)
    ) {
      add(
        `resources[${index}].fallbackResourceId`,
        `references unknown resource "${resource.fallbackResourceId}"`
      );
    }
  }

  const styleIds = new Set<string>([
    ...ir.styles.paragraph.map((style) => style.id),
    ...ir.styles.character.map((style) => style.id),
  ]);
  const numberingRefs = new Set(ir.numbering.map((n) => n.reference));

  const scope: Scope = {
    ir,
    resourceIds,
    styleIds,
    numberingRefs,
    footnoteIds: new Set(ir.footnotes.map((n) => n.id)),
    endnoteIds: new Set(ir.endnotes.map((n) => n.id)),
    commentIds: new Set(ir.comments.map((c) => c.id)),
    add,
    openBookmarks: new Map(),
    openComments: new Set(),
  };

  ir.sections.forEach((section, index) => {
    const path = `sections[${index}]`;
    checkPageSetup(section.properties.page, `${path}.properties.page`, add);
    section.children.forEach((block, i) =>
      checkBlock(block, `${path}.children[${i}]`, scope)
    );
    for (const [kind, set] of [
      ['headers', section.headers],
      ['footers', section.footers],
    ] as const) {
      if (!set) continue;
      for (const variant of ['default', 'first', 'even'] as const) {
        const part = set[variant];
        if (!part) continue;
        part.children.forEach((block, i) =>
          checkBlock(block, `${path}.${kind}.${variant}.children[${i}]`, scope)
        );
      }
    }
  });

  ir.comments.forEach((comment, index) =>
    comment.children.forEach((block, i) =>
      checkBlock(block, `comments[${index}].children[${i}]`, scope)
    )
  );
  for (const [kind, notes] of [
    ['footnotes', ir.footnotes],
    ['endnotes', ir.endnotes],
  ] as const) {
    notes.forEach((note, index) =>
      note.children.forEach((block, i) =>
        checkBlock(block, `${kind}[${index}].children[${i}]`, scope)
      )
    );
  }

  for (const [id, name] of scope.openBookmarks) {
    add('bookmarks', `bookmark ${id} ("${name}") is opened but never closed`);
  }
  for (const id of scope.openComments) {
    add('comments', `comment range ${id} is opened but never closed`);
  }

  return violations;
}

/** Throw on the first invariant violation. Used by tests and debug builds. */
export function assertValidDocxIr(ir: DocxIR): void {
  const violations = validateDocxIr(ir);
  if (violations.length === 0) return;
  const detail = violations
    .map((v) => `  - ${v.path}: ${v.message}`)
    .join('\n');
  throw new Error(
    `DocxIR failed ${violations.length} invariant(s):\n${detail}`
  );
}

type Add = (path: string, message: string) => void;

function checkBlock(block: DocxIrBlock, path: string, scope: Scope): void {
  if (typeof block.id !== 'string' || block.id.length === 0) {
    scope.add(path, 'block has no id');
  }

  switch (block.kind) {
    case 'paragraph':
      if (block.styleId && !scope.styleIds.has(block.styleId)) {
        scope.add(
          `${path}.styleId`,
          `references unknown style "${block.styleId}"`
        );
      }
      if (block.numbering && !block.numbering.none) {
        if (!scope.numberingRefs.has(block.numbering.reference)) {
          scope.add(
            `${path}.numbering.reference`,
            `references unknown numbering "${block.numbering.reference}"`
          );
        }
        if (block.numbering.level < 0) {
          scope.add(`${path}.numbering.level`, 'expected a 0-based level');
        }
      }
      checkTwips(block.formatting, `${path}.formatting`, scope.add);
      block.children.forEach((inline, i) =>
        checkInline(inline, `${path}.children[${i}]`, scope)
      );
      return;

    case 'table':
      // A percentage grid is a share of the table, so it may be fractional; a
      // twips grid is a real measurement and must be whole.
      if (
        block.columnGrid.values.some(
          (w) =>
            w < 0 || (block.columnGrid.unit === 'twips' && !Number.isInteger(w))
        )
      ) {
        scope.add(
          `${path}.columnGrid`,
          block.columnGrid.unit === 'twips'
            ? 'expected non-negative integer twips'
            : 'expected non-negative percentages'
        );
      }
      block.rows.forEach((row, r) => {
        row.cells.forEach((cell, c) => {
          const cellPath = `${path}.rows[${r}].cells[${c}]`;
          if (cell.columnSpan !== undefined && cell.columnSpan < 1) {
            scope.add(`${cellPath}.columnSpan`, 'expected at least 1');
          }
          cell.children.forEach((child, i) =>
            checkBlock(child, `${cellPath}.children[${i}]`, scope)
          );
        });
      });
      return;

    case 'toc':
      if (block.headingRange) {
        const { from, to } = block.headingRange;
        if (from < 1 || to > 9 || from > to) {
          scope.add(`${path}.headingRange`, `invalid range ${from}-${to}`);
        }
      }
      return;

    default:
      assertNever(block, 'DocxIrBlock');
  }
}

function checkInline(inline: DocxIrInline, path: string, scope: Scope): void {
  switch (inline.kind) {
    case 'text':
      if (typeof inline.text !== 'string') {
        scope.add(`${path}.text`, 'expected a string');
      }
      checkRunFormatting(inline.formatting, `${path}.formatting`, scope.add);
      if (inline.styleId && !scope.styleIds.has(inline.styleId)) {
        scope.add(
          `${path}.styleId`,
          `references unknown style "${inline.styleId}"`
        );
      }
      return;

    case 'image':
      if (!scope.resourceIds.has(inline.resourceId)) {
        scope.add(
          `${path}.resourceId`,
          `references unknown resource "${inline.resourceId}"`
        );
      }
      for (const key of ['widthEmu', 'heightEmu'] as const) {
        if (!Number.isInteger(inline[key]) || inline[key] < 0) {
          scope.add(`${path}.${key}`, `expected a non-negative integer EMU`);
        }
      }
      return;

    case 'hyperlink':
      if (
        inline.target.kind === 'external' &&
        inline.target.url.trim() === ''
      ) {
        scope.add(`${path}.target.url`, 'expected a non-empty url');
      }
      inline.children.forEach((child, i) =>
        checkInline(child, `${path}.children[${i}]`, scope)
      );
      return;

    case 'bookmarkStart':
      if (scope.openBookmarks.has(inline.id)) {
        scope.add(`${path}.id`, `bookmark ${inline.id} opened twice`);
      }
      scope.openBookmarks.set(inline.id, inline.name);
      return;

    case 'bookmarkEnd':
      if (!scope.openBookmarks.delete(inline.id)) {
        scope.add(`${path}.id`, `bookmark ${inline.id} closed without a start`);
      }
      return;

    case 'commentRangeStart':
      if (!scope.commentIds.has(inline.id)) {
        scope.add(`${path}.id`, `references unknown comment ${inline.id}`);
      }
      scope.openComments.add(inline.id);
      return;

    case 'commentRangeEnd':
      if (!scope.openComments.delete(inline.id)) {
        scope.add(
          `${path}.id`,
          `comment range ${inline.id} closed without a start`
        );
      }
      return;

    case 'commentReference':
      if (!scope.commentIds.has(inline.id)) {
        scope.add(`${path}.id`, `references unknown comment ${inline.id}`);
      }
      return;

    case 'noteReference': {
      const known =
        inline.noteKind === 'footnote' ? scope.footnoteIds : scope.endnoteIds;
      if (!known.has(inline.id)) {
        scope.add(
          `${path}.id`,
          `references unknown ${inline.noteKind} ${inline.id}`
        );
      }
      return;
    }

    case 'revision':
      if (!inline.author) scope.add(`${path}.author`, 'expected an author');
      if (Number.isNaN(Date.parse(inline.date))) {
        scope.add(
          `${path}.date`,
          `expected an ISO 8601 date, got "${inline.date}"`
        );
      }
      inline.children.forEach((child, i) =>
        checkInline(child, `${path}.children[${i}]`, scope)
      );
      return;

    case 'field':
      if (!inline.instruction.trim()) {
        scope.add(`${path}.instruction`, 'expected a field instruction');
      }
      return;

    case 'shape':
      for (const key of ['widthPx', 'heightPx'] as const) {
        if (!Number.isInteger(inline[key]) || inline[key] <= 0) {
          scope.add(`${path}.${key}`, 'expected a positive integer pixel size');
        }
      }
      inline.children.forEach((child, i) =>
        checkBlock(child, `${path}.children[${i}]`, scope)
      );
      return;

    case 'lineBreak':
    case 'pageBreak':
    case 'columnBreak':
    case 'tab':
      return;

    default:
      assertNever(inline, 'DocxIrInline');
  }
}

function checkRunFormatting(
  formatting: DocxIrRunFormatting | undefined,
  path: string,
  add: Add
): void {
  if (!formatting) return;
  if (formatting.color) checkColor(formatting.color, `${path}.color`, add);
  if (
    formatting.sizeHalfPoints !== undefined &&
    (!Number.isInteger(formatting.sizeHalfPoints) ||
      formatting.sizeHalfPoints <= 0)
  ) {
    add(
      `${path}.sizeHalfPoints`,
      `expected a positive integer, got ${formatting.sizeHalfPoints}`
    );
  }
  if (formatting.underline?.color) {
    checkColor(formatting.underline.color, `${path}.underline.color`, add);
  }
  if (formatting.shading) {
    checkColor(formatting.shading.fill, `${path}.shading.fill`, add);
  }
}

/** Every `*Twips` value on a paragraph's spacing and indent must be integral. */
function checkTwips(
  formatting: DocxIrParagraphFormatting | undefined,
  path: string,
  add: Add
): void {
  if (!formatting) return;
  for (const group of ['spacing', 'indent'] as const) {
    const values = formatting[group] as Record<string, unknown> | undefined;
    if (!values) continue;
    for (const [key, value] of Object.entries(values)) {
      if (!key.endsWith('Twips')) continue;
      if (typeof value === 'number' && !Number.isInteger(value)) {
        add(`${path}.${group}.${key}`, `expected an integer, got ${value}`);
      }
    }
  }
}

function checkColor(color: DocxIrColor, path: string, add: Add): void {
  if (!HEX6.test(color.hex)) {
    add(path, `expected bare uppercase 6-digit hex, got "${color.hex}"`);
  }
}

function checkPageSetup(
  page: DocxIR['sections'][number]['properties']['page'],
  path: string,
  add: Add
): void {
  for (const key of ['widthTwips', 'heightTwips'] as const) {
    if (!Number.isInteger(page[key]) || page[key] <= 0) {
      add(`${path}.${key}`, `expected a positive integer, got ${page[key]}`);
    }
  }
  for (const [key, value] of Object.entries(page.margins)) {
    if (typeof value === 'number' && !Number.isInteger(value)) {
      add(`${path}.margins.${key}`, `expected an integer, got ${value}`);
    }
  }
}
