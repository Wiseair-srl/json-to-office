import { describe, it, expect } from 'vitest';
import {
  documentFontRegistry,
  themeFontRegistry,
  mergeFontRegistries,
} from '../document-registry';
import type { FontRegistryEntry } from '../../schemas/font-catalog';

const entry = (
  id: string,
  family: string,
  sourceFamily = family
): FontRegistryEntry => ({
  id,
  family,
  sources: [{ kind: 'google', family: sourceFamily }],
});

describe('documentFontRegistry', () => {
  it('reads props.fontRegistry off a document root', () => {
    const e = entry('inter', 'Inter');
    expect(
      documentFontRegistry({ name: 'docx', props: { fontRegistry: [e] } })
    ).toEqual([e]);
  });

  it('returns empty for absent, null, or non-object input', () => {
    expect(documentFontRegistry({ name: 'docx', props: {} })).toEqual([]);
    expect(documentFontRegistry({ name: 'docx' })).toEqual([]);
    expect(documentFontRegistry(null)).toEqual([]);
    expect(documentFontRegistry('nope')).toEqual([]);
  });

  it('filters out entries that are not shaped like a registry entry', () => {
    const good = entry('inter', 'Inter');
    const doc = {
      props: {
        fontRegistry: [
          good,
          { id: 'x' }, // no family, no sources
          { family: 'Y', sources: [] }, // no id
          null,
          'string',
        ],
      },
    };
    expect(documentFontRegistry(doc)).toEqual([good]);
  });

  it('ignores a non-array fontRegistry', () => {
    expect(
      documentFontRegistry({ props: { fontRegistry: { id: 'inter' } } })
    ).toEqual([]);
  });
});

describe('themeFontRegistry', () => {
  it('reads fontRegistry off a theme root', () => {
    const e = entry('brand', 'Brand Sans');
    expect(themeFontRegistry({ fonts: {}, fontRegistry: [e] })).toEqual([e]);
  });

  it('returns empty for a theme without a registry', () => {
    expect(themeFontRegistry({ fonts: {} })).toEqual([]);
    expect(themeFontRegistry(undefined)).toEqual([]);
  });
});

describe('mergeFontRegistries', () => {
  it('applies theme < document < runtime precedence on family collision', () => {
    const fromTheme = entry('inter', 'Inter', 'ThemeSource');
    const fromDoc = entry('inter', 'Inter', 'DocSource');
    const fromRuntime = entry('inter', 'Inter', 'RuntimeSource');

    const merged = mergeFontRegistries([fromTheme], [fromDoc], [fromRuntime]);
    expect(merged).toHaveLength(1);
    expect(merged[0].sources[0]).toMatchObject({ family: 'RuntimeSource' });
  });

  it('lets the document win over the theme when no runtime entry exists', () => {
    const merged = mergeFontRegistries(
      [entry('inter', 'Inter', 'ThemeSource')],
      [entry('inter', 'Inter', 'DocSource')],
      undefined
    );
    expect(merged[0].sources[0]).toMatchObject({ family: 'DocSource' });
  });

  it('collides on id as well as family', () => {
    const merged = mergeFontRegistries(
      [entry('brand', 'Brand Sans', 'Old')],
      [entry('brand', 'Brand Sans', 'New')]
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].sources[0]).toMatchObject({ family: 'New' });
  });

  it('keeps both entries when a shared id declares two different families', () => {
    // Faithful to FontRegistry.addEntry, which indexes on family AND id: the
    // later entry takes the shared `id` key and its own family key, while the
    // earlier entry stays reachable under its family. Both names resolve, so
    // both entries must survive the merge.
    const a: FontRegistryEntry = {
      id: 'brand',
      family: 'Brand Sans',
      sources: [{ kind: 'google', family: 'Old' }],
    };
    const b: FontRegistryEntry = {
      id: 'brand',
      family: 'Brand Sans Renamed',
      sources: [{ kind: 'google', family: 'New' }],
    };
    const merged = mergeFontRegistries([a], [b]);
    expect(merged).toHaveLength(2);
    expect(merged).toEqual(expect.arrayContaining([a, b]));
  });

  it('matches case-insensitively', () => {
    const merged = mergeFontRegistries(
      [entry('inter', 'Inter', 'Lower')],
      [entry('INTER', 'INTER', 'Upper')]
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].sources[0]).toMatchObject({ family: 'Upper' });
  });

  it('keeps distinct families and returns each entry exactly once', () => {
    const merged = mergeFontRegistries([
      entry('inter', 'Inter'),
      entry('roboto', 'Roboto'),
    ]);
    expect(merged).toHaveLength(2);
    expect(merged.map((e) => e.family).sort()).toEqual(['Inter', 'Roboto']);
  });

  it('tolerates empty and undefined groups', () => {
    expect(mergeFontRegistries(undefined, [], undefined)).toEqual([]);
  });
});

describe('precedence survives the FontRegistry replay', () => {
  // FontRegistry re-derives precedence from ARRAY ORDER (addEntry, last write
  // wins). A merge that returns the right entries in the wrong order is
  // therefore still wrong — these cases pin the order itself.
  const lastIndexOwning = (
    merged: FontRegistryEntry[],
    family: string
  ): FontRegistryEntry | undefined => {
    let owner: FontRegistryEntry | undefined;
    for (const e of merged) {
      if (
        e.family.toLowerCase() === family.toLowerCase() ||
        e.id.toLowerCase() === family.toLowerCase()
      ) {
        owner = e;
      }
    }
    return owner;
  };

  it('lets the document win when it shares a family but not an id', () => {
    const theme: FontRegistryEntry = {
      id: 'brand-sans',
      family: 'Inter',
      sources: [{ kind: 'google', family: 'THEME' }],
    };
    const doc: FontRegistryEntry = {
      id: 'Inter',
      family: 'Inter',
      sources: [{ kind: 'google', family: 'DOC' }],
    };
    const merged = mergeFontRegistries([theme], [doc]);
    expect(lastIndexOwning(merged, 'Inter')).toBe(doc);
  });

  it('lets runtime win when it shares a family but not an id', () => {
    const doc: FontRegistryEntry = {
      id: 'doc-id',
      family: 'Inter',
      sources: [{ kind: 'google', family: 'DOC' }],
    };
    const runtime: FontRegistryEntry = {
      id: 'runtime-id',
      family: 'Inter',
      sources: [{ kind: 'google', family: 'RUNTIME' }],
    };
    const merged = mergeFontRegistries(undefined, [doc], [runtime]);
    expect(lastIndexOwning(merged, 'Inter')).toBe(runtime);
  });

  it('orders a true replacement last rather than in the slot it replaced', () => {
    const theme = entry('inter', 'Inter', 'THEME');
    const other = entry('roboto', 'Roboto');
    const doc = entry('inter', 'Inter', 'DOC');
    const merged = mergeFontRegistries([theme, other], [doc]);
    expect(merged).toHaveLength(2);
    expect(merged[merged.length - 1]).toBe(doc);
  });
});
