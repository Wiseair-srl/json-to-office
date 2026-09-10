/**
 * Key takeaways (#334): the block compiles to a rule, a label, a list and a
 * rule, and every complaint about it still lands on the slot the author
 * wrote. Bounds come from the definition — three to five items, twenty-five
 * words each, one line — so a document that copies and edits the definition
 * is judged by its own numbers.
 */
import { describe, expect, it } from 'vitest';
import AdmZip from 'adm-zip';
import { validateDocument } from '@json-to-office/shared-docx';
import { QUALITY_CODES } from '@json-to-office/quality';
import { generateBufferFromJson } from '../../core/generator';
import { analyzeDocxQuality } from '../../quality/preflight';
import { consultingTheme } from '../../styles';
import { expandBlocks, toAuthoredPointer } from '../index';
import { block, example, section } from './example';

const SLOTS = '/children/0/children/0/props/slots';
const takeaways = (slots: Record<string, unknown>) => {
  const doc = example();
  doc.props.theme = 'consulting';
  doc.children = [section(block('key-takeaways', slots))];
  return doc;
};
const items = (count: number, words = 3) =>
  Array.from({ length: count }, (_, i) =>
    [`Takeaway${i + 1}`, ...Array.from({ length: words - 1 }, () => 'word')]
      .join(' ')
      .concat('.')
  );
const budgets = (doc: unknown) =>
  validateDocument(doc).errors.filter(
    (issue) => issue.code === 'block_slot_budget'
  );

describe('a valid key-takeaways invocation', () => {
  it.each([3, 4, 5])('validates and renders %i items', async (count) => {
    const doc = takeaways({ items: items(count) });
    expect(validateDocument(doc).valid).toBe(true);
    expect(analyzeDocxQuality(doc).diagnostics).toEqual([]);
    const main = new AdmZip(await generateBufferFromJson(doc)).readAsText(
      'word/document.xml'
    );
    expect(main).toContain('Key takeaways');
    for (const item of items(count)) expect(main).toContain(item);
  });
  it('compiles to the rule, label, list and rule the definition draws', () => {
    const expanded = expandBlocks(
      takeaways({ items: items(3) }),
      consultingTheme
    );
    const compiled = expanded.document.children[0].children[0];
    expect(compiled.name).toBe('group');
    expect(
      compiled.children.map((child: { name: string }) => child.name)
    ).toEqual(['divider', 'paragraph', 'list', 'divider']);
    // Every compiled item still knows the slot entry it was written in.
    expect(
      toAuthoredPointer(
        expanded.sourceMap,
        '/children/0/children/0/children/2/props/items/2'
      )
    ).toBe(`${SLOTS}/items/2`);
  });
});

describe('an invalid key-takeaways invocation', () => {
  it('reports too few items at the slot that holds them', () => {
    expect(budgets(takeaways({ items: items(2) }))).toEqual([
      expect.objectContaining({
        path: `${SLOTS}/items`,
        message: 'Minimum item count is 3.',
      }),
    ]);
  });
  it('reports too many items at the same slot', () => {
    expect(budgets(takeaways({ items: items(6) }))).toEqual([
      expect.objectContaining({
        path: `${SLOTS}/items`,
        message: 'Maximum item count is 5.',
      }),
    ]);
  });
  it('reports an overlong item at that item, not at the list', () => {
    const doc = takeaways({ items: [...items(2), items(1, 26)[0]] });
    expect(budgets(doc)).toEqual([
      expect.objectContaining({
        path: `${SLOTS}/items/2`,
        message: 'Maximum word count is 25.',
      }),
    ]);
  });
  it('reports an item broken over two lines', () => {
    const doc = takeaways({ items: ['One.\nTwo.', ...items(2)] });
    expect(budgets(doc)).toEqual([
      expect.objectContaining({
        path: `${SLOTS}/items/0`,
        message: 'Slot must contain one line.',
      }),
    ]);
  });
  it('reports an overlong label at the label slot', () => {
    const doc = takeaways({
      label: 'What the reader should take away from this section today',
      items: items(3),
    });
    expect(budgets(doc)).toEqual([
      expect.objectContaining({
        path: `${SLOTS}/label`,
        message: 'Maximum word count is 8.',
      }),
    ]);
  });
  it('reports an unfilled item as a scaffold marker at its slot, not in the compiled list', () => {
    const doc = takeaways({ items: ['{{First takeaway}}', ...items(2)] });
    // A marker is guidance about the content to come: it is reported as one
    // and never measured against the item's word budget.
    expect(budgets(doc)).toEqual([]);
    expect(
      analyzeDocxQuality(doc).diagnostics.filter(
        (finding) => finding.code === QUALITY_CODES.SCAFFOLD_MARKER
      )
    ).toEqual([expect.objectContaining({ path: `${SLOTS}/items/0` })]);
  });
});
