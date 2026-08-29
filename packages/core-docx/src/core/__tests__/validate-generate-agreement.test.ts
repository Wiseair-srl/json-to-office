/**
 * Regression: the standalone validator and generation-time validation must
 * agree — a document `validate`/`validateStrict` accepts, generation must
 * accept too, and one they reject, generation must reject. The `jto_validate`
 * contract states `ok` mirrors generation, so any drift between the two is a
 * bug regardless of which side is "right".
 *
 * The table cell `font` object is the surface that drifted historically (a
 * cell `font.lineSpacing` was accepted in one path and rejected in the other),
 * so it is property-swept here across every nested font site the table schema
 * has: per-cell, per-header, per-column defaults, and the table-wide
 * cell/header defaults.
 */
import { describe, it, expect } from 'vitest';
import { validate, validateStrict } from '@json-to-office/shared-docx';
import { generateBufferFromJson } from '../generator';

type Json = Record<string, unknown>;

/** All the places a table can state a cell font. */
const FONT_SITES: Record<string, (font: Json) => Json> = {
  'columns[].cells[].font': (font) => ({
    columns: [{ header: { content: 'H' }, cells: [{ content: 'A', font }] }],
  }),
  'columns[].header.font': (font) => ({
    columns: [{ header: { content: 'H', font }, cells: [{ content: 'A' }] }],
  }),
  'columns[].cellDefaults.font': (font) => ({
    columns: [
      {
        cellDefaults: { font },
        header: { content: 'H' },
        cells: [{ content: 'A' }],
      },
    ],
  }),
  'cellDefaults.font': (font) => ({
    cellDefaults: { font },
    columns: [{ header: { content: 'H' }, cells: [{ content: 'A' }] }],
  }),
  'headerCellDefaults.font': (font) => ({
    headerCellDefaults: { font },
    columns: [{ header: { content: 'H' }, cells: [{ content: 'A' }] }],
  }),
};

function tableDoc(site: string, font: Json): Json {
  return {
    name: 'docx',
    props: { theme: 'minimal' },
    children: [{ name: 'table', props: FONT_SITES[site]!(font) }],
  };
}

async function generationAccepts(doc: Json): Promise<boolean> {
  try {
    await generateBufferFromJson(doc as never);
    return true;
  } catch {
    return false;
  }
}

/** Assert the validator verdicts and the generation verdict are identical. */
async function expectAgreement(doc: Json, label: string): Promise<boolean> {
  const json = JSON.stringify(doc);
  const lenient = validate.jsonDocument(json).valid;
  const strict = validateStrict.jsonDocument(json).valid;
  const generated = await generationAccepts(doc);
  expect({ label, strict, generated }).toEqual({
    label,
    strict: lenient,
    generated: lenient,
  });
  return generated;
}

// Every property the cell font schema accepts, exercised together. Values are
// renderable so the agreed verdict must be "accept" on every site.
const FULL_VALID_FONT: Json = {
  family: 'Arial',
  size: 9,
  bold: true,
  fontWeight: 600,
  italic: true,
  underline: true,
  lineSpacing: { type: 'exactly', value: 12 },
};

// Shapes both sides must refuse: properties the cell font does not have
// (`color` lives on the cell, not its font; `spacing`/`characterSpacing`/
// `scale` are paragraph-font-only), malformed lineSpacing, and junk.
const INVALID_FONTS: Record<string, Json> = {
  'unknown property': { size: 9, bogus: 1 },
  'font-level color': { size: 9, color: '#FF0000' },
  'paragraph-only spacing': { size: 9, spacing: { after: 4 } },
  'paragraph-only characterSpacing': {
    size: 9,
    characterSpacing: { type: 'expanded', value: 20 },
  },
  'paragraph-only scale': { size: 9, scale: 90 },
  'lineSpacing with unknown key': {
    lineSpacing: { type: 'exactly', value: 12, bogus: 1 },
  },
  'lineSpacing with bad type': { lineSpacing: { type: 'tight', value: 12 } },
  'lineSpacing as bare number': { lineSpacing: 1.5 },
};

describe('validator and generation agree on table cell fonts', () => {
  it.each(Object.keys(FONT_SITES))(
    'every font property at %s',
    async (site) => {
      const accepted = await expectAgreement(
        tableDoc(site, FULL_VALID_FONT),
        site
      );
      // Agreement alone could be satisfied by both sides rejecting; these
      // are all documented, renderable properties, so both must accept.
      expect(accepted).toBe(true);
    }
  );

  it.each(Object.entries(INVALID_FONTS))(
    'rejects %s in both paths, at every site',
    async (label, font) => {
      for (const site of Object.keys(FONT_SITES)) {
        const accepted = await expectAgreement(
          tableDoc(site, font),
          `${site}: ${label}`
        );
        expect(accepted).toBe(false);
      }
    }
  );

  it('property-sweeps the reported repro shape one property at a time', async () => {
    // Each valid property alone, at the site the drift was reported on.
    for (const [key, value] of Object.entries(FULL_VALID_FONT)) {
      const accepted = await expectAgreement(
        tableDoc('columns[].cells[].font', { [key]: value }),
        `cells[].font.${key}`
      );
      expect(accepted).toBe(true);
    }
  }, 30_000);
});
