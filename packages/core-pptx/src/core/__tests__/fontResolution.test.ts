import { describe, it, expect } from 'vitest';
import { resolveDocumentFonts } from '../fontResolution';
import type {
  PresentationComponentDefinition,
  PipelineWarning,
  PptxThemeConfig,
} from '../../types';

function docReferencingInter(): PresentationComponentDefinition {
  return {
    name: 'pptx',
    props: {},
    children: [
      {
        name: 'slide',
        props: {},
        children: [
          {
            name: 'text',
            props: { text: 'x', fontFace: 'Inter' },
          },
        ],
      },
    ],
  } as unknown as PresentationComponentDefinition;
}

const MINIMAL_THEME: PptxThemeConfig = {} as PptxThemeConfig;

describe('resolveDocumentFonts strict mode (pptx)', () => {
  it('throws on unresolved non-safe reference when strict is true', async () => {
    const warnings: PipelineWarning[] = [];
    await expect(
      resolveDocumentFonts(docReferencingInter(), MINIMAL_THEME, warnings, {
        strict: true,
        mode: 'custom',
        onResolved: () => {},
      })
    ).rejects.toThrow(/strict mode/i);
  });

  it('does not throw on unresolved reference when strict is false', async () => {
    const warnings: PipelineWarning[] = [];
    await expect(
      resolveDocumentFonts(docReferencingInter(), MINIMAL_THEME, warnings, {
        mode: 'custom',
        onResolved: () => {},
      })
    ).resolves.toBeDefined();
    expect(
      warnings.some(
        (w) => w.code === 'FONT_UNRESOLVED' && /Inter/.test(w.message)
      )
    ).toBe(true);
  });

  it('does not throw in strict mode when the reference is resolved via extraEntries', async () => {
    const warnings: PipelineWarning[] = [];
    await expect(
      resolveDocumentFonts(docReferencingInter(), MINIMAL_THEME, warnings, {
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
    const warnings: PipelineWarning[] = [];
    const custom = await resolveDocumentFonts(
      docReferencingInter(),
      MINIMAL_THEME,
      warnings,
      { mode: 'custom' }
    );
    expect(custom).toEqual([]);
    expect(
      warnings.some(
        (w) => w.code === 'FONT_UNRESOLVED' && /Inter/.test(w.message)
      )
    ).toBe(true);

    const substituteWarnings: PipelineWarning[] = [];
    const substitute = await resolveDocumentFonts(
      docReferencingInter(),
      MINIMAL_THEME,
      substituteWarnings,
      { mode: 'substitute' }
    );
    expect(substitute).toEqual([]);
  });

  it('fires onResolved exactly once when a listener is registered', async () => {
    const warnings: PipelineWarning[] = [];
    const calls: unknown[] = [];
    await resolveDocumentFonts(docReferencingInter(), MINIMAL_THEME, warnings, {
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
