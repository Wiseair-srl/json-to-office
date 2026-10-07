/**
 * Page numbers for a table of contents, worked out by `docx/layout`.
 *
 * docx 9.9.0 lays a document's pages out as Word does when it is given a
 * `pageNumbers` estimator, and writes what it works out into the fields that
 * show a page: the `PAGEREF` of each contents entry, `NUMPAGES` and
 * `SECTIONPAGES`. Those fields are then written clean, so Word shows the
 * numbers without asking to update the fields, and a reader that never updates
 * them — LibreOffice, a PDF preview, QuickLook — shows numbers instead of
 * blanks. docx.js fills each contents field from the headings itself, with a
 * `_Toc` bookmark on each heading and a `PAGEREF` per entry, which is what the
 * estimator fills; the cached entries jto computes carry no `PAGEREF`, so the
 * adapter no longer hands them to docx.js (`emitToc`).
 *
 * Only a document with a contents field loads `docx/layout`, a 1.7 MB module:
 * every other document renders exactly as before and loads nothing more. A
 * `PAGE` field needs no estimate, and `NUMPAGES` is counted again by every
 * reader as it lays the pages out, so neither is a reason to lay a document out
 * on its own; in a document with a contents field they are filled as well.
 *
 * The layout guesses past what it cannot lay out as Word does yet — a frame, a
 * floating table, a font outside its width tables, such as Helvetica — rather
 * than leave the numbers after it blank (`guess: true`). When it lays the
 * whole document out without a guess, the numbers are Word's as near as the
 * layout knows, and the package stops asking Word to update its fields on
 * open. When it guessed, or stopped, `updateFields` stays on, so Word corrects
 * what was guessed. When it throws, the contents field keeps its entries
 * without numbers, `updateFields` stays on, and the render says so with
 * `W_DOCX_PAGE_NUMBERS_UNAVAILABLE` rather than fail the document.
 */

import {
  Tab,
  type EstimatedPageNumbers,
  type File,
  type IContext,
  type IXmlableObject,
  type PageNumberEstimator,
} from 'docx';
import type { DocxIR, DocxIrTableOfContents } from '../../ir/types';
import { reportWarning } from '../../utils/generationContext';
import { docxSubpath } from './docxSubpath';

export const PAGE_NUMBERS_UNAVAILABLE = 'W_DOCX_PAGE_NUMBERS_UNAVAILABLE';

const layout = docxSubpath(
  'docx/layout',
  'toc',
  () => import('docx/layout'),
  '9.9.0'
);

/**
 * Whether a document's body has a contents field, at any depth. One in a
 * header, footer, note or comment keeps its cached entries (`emitToc`), which
 * have no page to fill.
 */
export function needsPageNumbers(ir: DocxIR): boolean {
  const seen = new Set<object>();
  const visit = (value: unknown): boolean => {
    if (typeof value !== 'object' || value === null) return false;
    if (ArrayBuffer.isView(value) || seen.has(value)) return false;
    seen.add(value);
    if (Array.isArray(value)) return value.some(visit);
    if ((value as { kind?: unknown }).kind === 'toc') return true;
    return Object.values(value).some(visit);
  };
  return ir.sections.some((section) => visit(section.children));
}

/**
 * The estimator for a document with a contents field: `docx/layout`'s, with a
 * guard and the house rules around it. Loads `docx/layout` first; a docx
 * without it gets an estimator that works out nothing, and a warning.
 */
export async function createPageNumberEstimator(
  ir: DocxIR
): Promise<PageNumberEstimator> {
  await layout.load();
  const cached = cachedContentsEntries(ir);
  const separators = contentsSeparators(ir);
  const estimate = layout.loaded()
    ? layout.get().estimatePageNumbersWith({ guess: true })
    : undefined;

  return (body: IXmlableObject, context: IContext): EstimatedPageNumbers => {
    renumberContentsBookmarks(body);
    restoreEntryNumbers(body, cached, separators);
    dropContentsEntryTabs(body);
    writeSeparatorTabs(body, context);
    endContentsInLastEntry(body);
    if (!estimate) {
      unavailable(
        `the \`docx/layout\` entry could not be loaded (${failureOf(() => layout.get())})`
      );
      return { bookmarks: new Map() };
    }
    try {
      const estimated = estimate(body, context);
      if (complete(estimated)) clearUpdateFields(context.file);
      return estimated;
    } catch (error) {
      unavailable(error instanceof Error ? error.message : String(error));
      return { bookmarks: new Map() };
    }
  };
}

function unavailable(reason: string): void {
  reportWarning(
    'toc',
    PAGE_NUMBERS_UNAVAILABLE,
    'The table of contents is written without page numbers: laying the ' +
      `pages out failed (${reason}). Word fills them in when it updates the ` +
      'fields on open.'
  );
}

function failureOf(get: () => unknown): string {
  try {
    get();
    return 'unknown';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * Whether the layout reached the end of the document without guessing: it
 * gives the number of pages only then, and lists every guess it made.
 */
function complete(estimated: EstimatedPageNumbers): boolean {
  return (
    estimated.pageCount !== undefined && (estimated.guesses ?? []).length === 0
  );
}

/**
 * Takes `w:updateFields` out of the document's settings.
 *
 * The estimator runs while the body is written, after the settings were built
 * and before they are written, so this is the one point where what it worked
 * out can still reach them. docx.js keeps a part's children in `root`;
 * `w:updateFields` is an `OnOffElement` there whenever the IR asked for it.
 */
function clearUpdateFields(file: File | undefined): void {
  const root = (file?.Settings as unknown as { root?: unknown[] } | undefined)
    ?.root;
  if (!root) return;
  const at = root.findIndex(
    (element) =>
      (element as { rootKey?: unknown } | null)?.rootKey === 'w:updateFields'
  );
  if (at >= 0) root.splice(at, 1);
}

/* ------------------------------------------------------------------ *
 * Contents entries take their tab stop from their style
 * ------------------------------------------------------------------ */

type Element = Record<string, unknown>;

const nameOf = (element: unknown): string | undefined =>
  typeof element === 'object' && element !== null && !Array.isArray(element)
    ? Object.keys(element)[0]
    : undefined;

const childrenOf = (element: unknown): unknown[] => {
  const name = nameOf(element);
  const content = name === undefined ? undefined : (element as Element)[name];
  return Array.isArray(content)
    ? content
    : content === undefined
      ? []
      : [content];
};

/** Whether a formatted `w:sdt` holds a `TOC` field. */
function isContentsField(sdt: unknown): boolean {
  let found = false;
  const visit = (element: unknown): void => {
    if (found) return;
    if (nameOf(element) === 'w:instrText') {
      found = childrenOf(element).some(
        (child) => typeof child === 'string' && /^\s*TOC\b/.test(child)
      );
      return;
    }
    childrenOf(element).forEach(visit);
  };
  visit(sdt);
  return found;
}

/** The contents fields of a formatted body, in document order. */
function contentsFields(body: unknown): unknown[] {
  const found: unknown[] = [];
  const visit = (element: unknown): void => {
    const name = nameOf(element);
    if (name === undefined || name === '_attr') return;
    if (name === 'w:sdt' && isContentsField(element)) {
      found.push(element);
      return;
    }
    childrenOf(element).forEach(visit);
  };
  visit(body);
  return found;
}

/** The entry paragraphs of a formatted contents field. */
function entryParagraphs(field: unknown): unknown[] {
  return childrenOf(field)
    .filter((content) => nameOf(content) === 'w:sdtContent')
    .flatMap((content) =>
      childrenOf(content).filter((paragraph) => nameOf(paragraph) === 'w:p')
    );
}

/**
 * Removes the `w:tabs` docx.js gives every entry it writes into a contents
 * field.
 *
 * docx.js sets a dot-leader right tab at the text width on each entry, whatever
 * the theme says. Paragraph tabs beat style tabs, so the leader the theme's
 * `TOC1`..`TOC9` styles turn off would be drawn anyway. With no paragraph tabs
 * the entry takes its style's tab stop, as Word's own update does — the rule
 * the cached entries followed before docx.js filled the field. It runs before
 * the layout, so the pages are laid out with the tabs that are written.
 */
export function dropContentsEntryTabs(body: unknown): void {
  for (const field of contentsFields(body)) {
    for (const paragraph of entryParagraphs(field)) {
      for (const properties of childrenOf(paragraph)) {
        if (nameOf(properties) !== 'w:pPr') continue;
        (properties as Element)['w:pPr'] = childrenOf(properties).filter(
          (child) => nameOf(child) !== 'w:tabs'
        );
      }
    }
  }
}

/**
 * Moves the end of each contents field into its last entry.
 *
 * docx.js closes the field in a paragraph of its own after the entries, as
 * Word does, which costs a line under every table of contents: in LibreOffice
 * everything after one moved down by it. The cached entries ended the field in
 * the last entry, and so does this, so the page keeps the lines it had.
 */
export function endContentsInLastEntry(body: unknown): void {
  for (const field of contentsFields(body)) {
    for (const content of childrenOf(field)) {
      if (nameOf(content) !== 'w:sdtContent') continue;
      const paragraphs = childrenOf(content);
      const last = paragraphs[paragraphs.length - 1];
      const entry = paragraphs[paragraphs.length - 2];
      if (nameOf(last) !== 'w:p' || nameOf(entry) !== 'w:p') continue;
      const runs = childrenOf(last);
      const onlyTheEnd =
        runs.length === 1 &&
        nameOf(runs[0]) === 'w:r' &&
        childrenOf(runs[0]).every(
          (child) =>
            nameOf(child) === 'w:fldChar' &&
            attributesOf(child)?.['w:fldCharType'] === 'end'
        );
      // The begin run is in the first entry. A field with one entry or none
      // keeps the closing paragraph, as the cached entries did: docx.js wrote
      // one entry with the field's end after it.
      const entries = paragraphs.filter(
        (paragraph) => textNodes(paragraph).length > 0
      );
      if (!onlyTheEnd || entries.length < 2 || textNodes(entry).length === 0)
        continue;
      childrenOf(entry).push(runs[0]);
      paragraphs.pop();
    }
  }
}

/**
 * Writes a tab that separates an entry from its page as `w:tab`.
 *
 * jto states the separator, `\p "<tab>"`, and docx.js writes the one it is
 * given as text: a tab character in `w:t`, where the cached entries and Word
 * write a `w:tab` element. Only a run whose whole text is that one character
 * is rewritten.
 */
export function writeSeparatorTabs(body: unknown, context: IContext): void {
  const tab = () => new Tab().prepForXml(context);
  const visit = (element: unknown): void => {
    const name = nameOf(element);
    if (name === undefined || name === '_attr') return;
    if (name === 'w:r') {
      const children = childrenOf(element);
      children.forEach((child, index) => {
        if (nameOf(child) !== 'w:t') return;
        const text = childrenOf(child).filter(
          (part): part is string => typeof part === 'string'
        );
        if (text.length === 1 && text[0] === '\t') children[index] = tab();
      });
      return;
    }
    childrenOf(element).forEach(visit);
  };
  for (const field of contentsFields(body))
    entryParagraphs(field).forEach(visit);
}

/** The `w:t` strings of a formatted element, outside field instructions. */
function textNodes(element: unknown): { parent: unknown[]; index: number }[] {
  const name = nameOf(element);
  if (name === undefined || name === '_attr' || name === 'w:instrText')
    return [];
  const children = childrenOf(element);
  if (name === 'w:t')
    return children.flatMap((child, index) =>
      typeof child === 'string' ? [{ parent: children, index }] : []
    );
  return children.flatMap(textNodes);
}

/** The entry separator of each of the IR's contents fields, in document order. */
function contentsSeparators(ir: DocxIR): (string | undefined)[] {
  const separators: (string | undefined)[] = [];
  const visit = (value: unknown): void => {
    if (typeof value !== 'object' || value === null) return;
    if (ArrayBuffer.isView(value)) return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if ((value as { kind?: unknown }).kind === 'toc') {
      separators.push((value as DocxIrTableOfContents).entrySeparator);
      return;
    }
    Object.values(value).forEach(visit);
  };
  for (const section of ir.sections) visit(section.children);
  return separators;
}

/**
 * The cached entries of the IR's contents fields, in document order: the text
 * jto worked out for each entry, a heading's number included.
 */
export function cachedContentsEntries(ir: DocxIR): (string[] | undefined)[] {
  const fields: (string[] | undefined)[] = [];
  const visit = (value: unknown): void => {
    if (typeof value !== 'object' || value === null) return;
    if (ArrayBuffer.isView(value)) return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if ((value as { kind?: unknown }).kind === 'toc') {
      const toc = value as DocxIrTableOfContents;
      fields.push(toc.cachedEntries?.map((entry) => entry.text));
      return;
    }
    Object.values(value).forEach(visit);
  };
  for (const section of ir.sections) visit(section.children);
  return fields;
}

/**
 * Puts a numbered heading's number back in front of its entry.
 *
 * docx.js titles an entry with the heading's text, and a heading numbered by
 * its list (`w:numPr`) has its number outside the text, so "1.1. Purpose"
 * became "Purpose". Word's own update writes the number, and so did the cached
 * entries jto computes, which name it: where the cached entry ends with the
 * title docx.js wrote, what comes before is put in front of it. A field whose
 * entries do not line up with the cached ones, one for one, is left as docx.js
 * wrote it.
 */
export function restoreEntryNumbers(
  body: unknown,
  cached: readonly (readonly string[] | undefined)[],
  separators: readonly (string | undefined)[] = []
): void {
  contentsFields(body).forEach((field, index) => {
    const texts = cached[index];
    const paragraphs = entryParagraphs(field).filter(
      (paragraph) => textNodes(paragraph).length > 0
    );
    if (!texts || texts.length !== paragraphs.length) return;
    paragraphs.forEach((paragraph, entry) => {
      const nodes = textNodes(paragraph);
      let title = nodes
        .map(({ parent, index: at }) => parent[at] as string)
        .join('');
      const separator = separators[index];
      if (separator && title.endsWith(separator))
        title = title.slice(0, -separator.length);
      const text = texts[entry];
      if (title === '' || text === title || !text.endsWith(title)) return;
      const [first] = nodes;
      first.parent[first.index] =
        text.slice(0, text.length - title.length) +
        (first.parent[first.index] as string);
    });
  });
}

/* ------------------------------------------------------------------ *
 * Heading bookmarks numbered per document
 * ------------------------------------------------------------------ */

/**
 * The first `w:id` of the heading bookmarks docx.js adds for a contents field,
 * less one. jto's own bookmarks take three lower ranges: layout sections from
 * 1, nested sections from 1_000_000 and content from 2_000_000 (see
 * `CONTENT_BOOKMARK_ID_BASE` in the compiler).
 */
export const CONTENTS_BOOKMARK_ID_BASE = 3_000_000;

const CONTENTS_BOOKMARK = /^_Toc\d+$/;

/**
 * Names and numbers the `_Toc` bookmarks docx.js put on the headings a
 * contents field lists, in document order: `_Toc1` with `w:id` 3000001, and on.
 *
 * docx.js takes both from a counter shared by the whole process, so the second
 * document written in a process had `_Toc6` where the first had `_Toc1`, and
 * the id it gave the first heading, 1, was the id of the first section's own
 * bookmark: two ranges sharing a `w:id`, which pairs starts with ends. Each
 * bookmark sits around its heading paragraph's content — its start after the
 * paragraph properties, its end the paragraph's last child — and is named by
 * the entry's hyperlink anchor and its `PAGEREF`, which follow it here.
 */
export function renumberContentsBookmarks(body: unknown): void {
  const names = new Map<string, string>();
  const paragraphs = (element: unknown): void => {
    const name = nameOf(element);
    if (name === undefined || name === '_attr') return;
    if (name !== 'w:p') {
      childrenOf(element).forEach(paragraphs);
      return;
    }
    const children = childrenOf(element);
    for (const start of children) {
      if (nameOf(start) !== 'w:bookmarkStart') continue;
      const attributes = attributesOf(start);
      const old = attributes?.['w:name'];
      if (typeof old !== 'string' || !CONTENTS_BOOKMARK.test(old)) continue;
      const ordinal = names.size + 1;
      const renamed = `_Toc${ordinal}`;
      const id = CONTENTS_BOOKMARK_ID_BASE + ordinal;
      names.set(old, renamed);
      const oldId = attributes!['w:id'];
      attributes!['w:name'] = renamed;
      attributes!['w:id'] = id;
      const end = [...children]
        .reverse()
        .find(
          (child) =>
            nameOf(child) === 'w:bookmarkEnd' &&
            String(attributesOf(child)?.['w:id']) === String(oldId)
        );
      if (end) attributesOf(end)!['w:id'] = id;
    }
  };
  paragraphs(body);
  if (names.size === 0) return;

  const references = (element: unknown): void => {
    const name = nameOf(element);
    if (name === undefined) return;
    if (name === 'w:hyperlink') {
      const attributes = attributesOf(element);
      const anchor = attributes?.['w:anchor'];
      if (typeof anchor === 'string' && names.has(anchor))
        attributes!['w:anchor'] = names.get(anchor);
    }
    if (name === 'w:instrText') {
      const children = childrenOf(element);
      children.forEach((child, index) => {
        if (typeof child !== 'string') return;
        children[index] = child.replace(
          /\b(PAGEREF\s+)(_Toc\d+)\b/g,
          (match, field: string, bookmark: string) =>
            names.has(bookmark) ? `${field}${names.get(bookmark)}` : match
        );
      });
      (element as Element)[name] = children;
      return;
    }
    if (name === '_attr') return;
    childrenOf(element).forEach(references);
  };
  references(body);
}

/** The attributes of a formatted element, if it has any. */
function attributesOf(element: unknown): Record<string, unknown> | undefined {
  const attributes = childrenOf(element).find(
    (child) => nameOf(child) === '_attr'
  );
  return (attributes as { _attr?: Record<string, unknown> } | undefined)?._attr;
}
