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
