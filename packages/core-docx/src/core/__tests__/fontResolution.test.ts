import { describe, it, expect } from 'vitest';
import { resolveDocumentFonts } from '../fontResolution';
import type { ReportComponentDefinition } from '../../types';
import type { ThemeConfig } from '../../styles';

// Reaches the validation path by combining `custom` mode with an
// `onResolved` callback — the short-circuit only fires when no listener
// needs the resolved list, so this exercises the validator + strict guard.
function docReferencingInter(): ReportComponentDefinition {
  return {
    name: 'docx',
    props: {},
    children: [
      {
        name: 'paragraph',
        props: { text: 'x', font: { family: 'Inter' } },
      },
    ],
  } as unknown as ReportComponentDefinition;
}

const MINIMAL_THEME: ThemeConfig = {} as ThemeConfig;

describe('resolveDocumentFonts strict mode (docx)', () => {
  it('throws on unresolved non-safe reference when strict is true', async () => {
    await expect(
      resolveDocumentFonts(docReferencingInter(), MINIMAL_THEME, {
        strict: true,
        mode: 'custom',
        onResolved: () => {},
      })
    ).rejects.toThrow(/strict mode/i);
  });

  it('does not throw on unresolved reference when strict is false', async () => {
    const warnings: any[] = [];
    await expect(
      resolveDocumentFonts(
        docReferencingInter(),
        MINIMAL_THEME,
        { mode: 'custom', onResolved: () => {} },
        warnings
      )
    ).resolves.toBeDefined();
    expect(
      warnings.some(
        (w) => w.context?.code === 'FONT_UNRESOLVED' && /Inter/.test(w.message)
      )
    ).toBe(true);
  });

  it('does not throw in strict mode when the reference is resolved via extraEntries', async () => {
    await expect(
      resolveDocumentFonts(docReferencingInter(), MINIMAL_THEME, {
        strict: true,
        mode: 'custom',
        onResolved: () => {},
        extraEntries: [
          {
            id: 'Inter',
            family: 'Inter',
            sources: [{ kind: 'google', family: 'Inter' }],
          },
        ],
      })
    ).resolves.toBeDefined();
  });

  it('short-circuits when no onResolved consumer regardless of mode', async () => {
    // Registry fetches only run for the LibreOffice preview stager, which
    // registers via `onResolved`. Without a listener the helper returns []
    // after validation — mode is irrelevant to this short-circuit.
    const warnings: any[] = [];
    const noListener = await resolveDocumentFonts(
      docReferencingInter(),
      MINIMAL_THEME,
      { mode: 'custom' },
      warnings
    );
    expect(noListener).toEqual([]);
    // Validation still ran: the Inter reference surfaced as a warning.
    expect(
      warnings.some(
        (w) => w.context?.code === 'FONT_UNRESOLVED' && /Inter/.test(w.message)
      )
    ).toBe(true);

    const out = await resolveDocumentFonts(
      docReferencingInter(),
      MINIMAL_THEME,
      {
        mode: 'substitute',
      }
    );
    expect(out).toEqual([]);
  });

  it('fires onResolved exactly once when a listener is registered', async () => {
    const calls: unknown[] = [];
    await resolveDocumentFonts(docReferencingInter(), MINIMAL_THEME, {
      mode: 'custom',
      onResolved: (resolved) => calls.push(resolved),
      extraEntries: [
        {
          id: 'Inter',
          family: 'Inter',
          sources: [{ kind: 'google', family: 'Inter' }],
        },
      ],
    });
    expect(calls).toHaveLength(1);
  });
});

describe('resolveDocumentFonts forceMaterialize (Area 6)', () => {
  // Inline base64 keeps these tests off the network: `kind: "data"` resolves
  // entirely in-process.
  const TTF = Buffer.concat([
    Buffer.from([0x00, 0x01, 0x00, 0x00]),
    Buffer.alloc(64),
  ]).toString('base64');

  const interEntry = {
    id: 'Inter',
    family: 'Inter',
    sources: [{ kind: 'data' as const, data: TTF, weight: 400 }],
  };

  it('returns [] with no listener and forceMaterialize false (status quo)', async () => {
    const resolved = await resolveDocumentFonts(
      docReferencingInter(),
      MINIMAL_THEME,
      { mode: 'custom', extraEntries: [interEntry] },
      [],
      false
    );
    expect(resolved).toEqual([]);
  });

  it('resolves and returns fonts with forceMaterialize true and NO listener', async () => {
    // The plain CLI path registers no listener, but a document with a
    // `visual` still needs real font bytes for the out-of-process render.
    const resolved = await resolveDocumentFonts(
      docReferencingInter(),
      MINIMAL_THEME,
      { mode: 'custom', extraEntries: [interEntry] },
      [],
      true
    );
    expect(resolved).toHaveLength(1);
    expect(resolved[0].family).toBe('Inter');
    expect(resolved[0].sources[0].data.length).toBeGreaterThan(0);
  });

  it('still fires the listener exactly once when both are present', async () => {
    const calls: unknown[] = [];
    const resolved = await resolveDocumentFonts(
      docReferencingInter(),
      MINIMAL_THEME,
      {
        mode: 'custom',
        extraEntries: [interEntry],
        onResolved: (r) => calls.push(r),
      },
      [],
      true
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe(resolved);
  });

  it('does not throw on the force path when no callback is registered', async () => {
    await expect(
      resolveDocumentFonts(
        docReferencingInter(),
        MINIMAL_THEME,
        { mode: 'custom', extraEntries: [interEntry] },
        [],
        true
      )
    ).resolves.toBeDefined();
  });

  it('returns [] for a document that references no fonts at all, even forced', async () => {
    const plain = {
      name: 'docx',
      props: {},
      children: [{ name: 'paragraph', props: { text: 'x' } }],
    } as any;
    await expect(
      resolveDocumentFonts(plain, MINIMAL_THEME, undefined, [], true)
    ).resolves.toEqual([]);
  });
});
