import { describe, it, expect } from 'vitest';
import { autoGoogleFontEntries, collectReferencedWeights } from '../generator';

/**
 * The narrowing this feeds decides which faces the LibreOffice preview gets
 * to stage. A weight the walk misses is a weight the host has to find on its
 * own — which works on a machine with the family installed and renders a
 * fallback everywhere else.
 */
describe('collectReferencedWeights', () => {
  it('collects numeric fontWeight values', () => {
    const doc = {
      children: [
        { name: 'paragraph', props: { font: { fontWeight: 500 } } },
        { name: 'paragraph', props: { font: { fontWeight: 600 } } },
      ],
    };
    expect(collectReferencedWeights(doc, undefined)).toEqual(
      new Set([500, 600])
    );
  });

  it('counts bold: true as a reference to 700', () => {
    // `bold: true` is shorthand for `fontWeight: 700` (font.ts's schema says
    // so) and the compiler resolves it to exactly that, so it names a face
    // the document will ask a host for.
    const doc = {
      children: [{ name: 'paragraph', props: { font: { bold: true } } }],
    };
    expect(collectReferencedWeights(doc, undefined)).toEqual(new Set([700]));
  });

  it('covers a document that mixes numeric weights with bold: true', () => {
    // The regression: referencing 500 took this doc off the "no explicit
    // weights" fallback of {400, 700}, and nothing put 700 back — so the
    // bold runs were never staged.
    const doc = {
      props: {
        componentDefaults: { paragraph: { font: { family: 'Inter' } } },
      },
      children: [
        { name: 'paragraph', props: { font: { fontWeight: 500 } } },
        { name: 'paragraph', props: { font: { bold: true } } },
      ],
    };
    expect(collectReferencedWeights(doc, undefined)).toEqual(
      new Set([500, 700])
    );
  });

  it('lets an explicit fontWeight on the same font win over its bold flag', () => {
    // Compiler precedence: `fontWeight ?? (bold ? 700 : undefined)`. The run
    // renders as Medium, so 700 is not a face this font needs.
    const doc = {
      children: [
        {
          name: 'paragraph',
          props: { font: { fontWeight: 500, bold: true } },
        },
      ],
    };
    expect(collectReferencedWeights(doc, undefined)).toEqual(new Set([500]));
  });

  it('reads bold off every text-bearing shape, not just paragraph fonts', () => {
    // `bold` lives on table cells and list markers too, and each renders in
    // the document's family.
    const doc = {
      children: [
        {
          name: 'table',
          props: { rows: [{ cells: [{ font: { bold: true } }] }] },
        },
      ],
    };
    expect(collectReferencedWeights(doc, undefined)).toEqual(new Set([700]));
  });

  it('walks custom themes as well as the document', () => {
    const themes = { mine: { styles: { heading1: { bold: true } } } };
    expect(collectReferencedWeights({ children: [] }, themes)).toEqual(
      new Set([700])
    );
  });

  it('ignores out-of-range and non-numeric fontWeight values', () => {
    const doc = {
      children: [
        { name: 'paragraph', props: { font: { fontWeight: 1000 } } },
        { name: 'paragraph', props: { font: { fontWeight: 'bold' } } },
      ],
    };
    expect(collectReferencedWeights(doc, undefined)).toEqual(new Set());
  });

  it('stays empty for a document that references no weight at all', () => {
    // Still the signal `autoGoogleFontEntries` reads to fall back to
    // {400, 700} — a bundled theme's own bold styles are out of this walk's
    // sight, so "nothing referenced" must not mean "fetch Regular only".
    const doc = {
      children: [{ name: 'paragraph', props: { text: 'plain' } }],
    };
    expect(collectReferencedWeights(doc, undefined)).toEqual(new Set());
  });
});

describe('autoGoogleFontEntries — weights reaching the fetcher', () => {
  it('keeps the bold variant for a doc that mixes fontWeight 500 with bold: true', () => {
    // End of the chain: Inter resolves through the upstream override, and
    // the variant filter is what decides whether a bold face is instanced
    // at all. This is the shape modern-annual-report-1 has.
    const entries = autoGoogleFontEntries(
      new Set(['Inter']),
      new Set(),
      collectReferencedWeights(
        {
          children: [
            { name: 'paragraph', props: { font: { fontWeight: 500 } } },
            { name: 'paragraph', props: { font: { bold: true } } },
          ],
        },
        undefined
      ),
      false
    );

    expect(entries).toHaveLength(1);
    const weights = entries[0].sources.map(
      (s) => (s as { weight: number }).weight
    );
    expect(new Set(weights)).toEqual(new Set([400, 500, 700]));
  });

  it('narrows to Regular when the doc asks for no bold anywhere', () => {
    // The saving this narrowing exists for still holds — bold is fetched
    // because it is referenced, not unconditionally.
    const entries = autoGoogleFontEntries(
      new Set(['Inter']),
      new Set(),
      collectReferencedWeights(
        {
          children: [
            { name: 'paragraph', props: { font: { fontWeight: 500 } } },
          ],
        },
        undefined
      ),
      false
    );

    const weights = entries[0].sources.map(
      (s) => (s as { weight: number }).weight
    );
    expect(new Set(weights)).toEqual(new Set([400, 500]));
  });
});
