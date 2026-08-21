/**
 * `props.fontRegistry` (and its theme-level twin) must actually satisfy font
 * validation. Before this existed, the schema documented the field and the
 * docs told authors to use it, but nothing read it — so a document that
 * correctly declared a non-safe family still emitted FONT_UNRESOLVED and the
 * playground preview silently fell back to a host font.
 */
import { describe, it, expect } from 'vitest';
import type { GenerationWarning, ResolvedFont } from '@json-to-office/shared';
import { generateBufferFromJson } from '../core/generator';
import { corporateTheme } from '../templates/themes';

const REGISTRY = [
  {
    id: 'brand-sans',
    family: 'Brand Sans',
    category: 'sans' as const,
    sources: [{ kind: 'google' as const, family: 'Inter' }],
  },
];

const paragraph = (family: string) => ({
  name: 'paragraph',
  props: { text: 'Body.', font: { family } },
});

/**
 * An inline source whose bytes name the registry that declared it. `wOFF` is
 * a real magic number, so the data loader accepts the payload; WOFF also
 * skips the TTF/OTF metadata validation that a fabricated face would trip.
 */
const markedSource = (marker: string) => ({
  kind: 'data' as const,
  data: Buffer.from(`wOFF ${marker}`).toString('base64'),
});

/** A built-in theme that additionally declares the brand family. */
const brandedTheme = () =>
  ({
    ...structuredClone(corporateTheme),
    fontRegistry: REGISTRY,
  }) as never;

async function warningsFor(doc: unknown): Promise<GenerationWarning[]> {
  const warnings: GenerationWarning[] = [];
  await generateBufferFromJson(doc as any, { warnings });
  return warnings;
}

const unresolved = (warnings: GenerationWarning[]) =>
  warnings.filter((w) => w.context?.code === 'FONT_UNRESOLVED');

describe('props.fontRegistry satisfies font validation', () => {
  it('warns FONT_UNRESOLVED for a non-safe family with no registry', async () => {
    const warnings = await warningsFor({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [paragraph('Brand Sans')],
    });
    const hits = unresolved(warnings);
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain('Brand Sans');
  });

  it('does not warn once the family is declared in props.fontRegistry', async () => {
    const warnings = await warningsFor({
      name: 'docx',
      props: { theme: 'minimal', fontRegistry: REGISTRY },
      children: [paragraph('Brand Sans')],
    });
    expect(unresolved(warnings)).toEqual([]);
  });

  it('accepts a registry document without a validation error', async () => {
    // props.fontRegistry lives under `additionalProperties: false`, so this
    // would be a hard "Document validation failed" without the schema change.
    await expect(
      generateBufferFromJson(
        {
          name: 'docx',
          props: { theme: 'minimal', fontRegistry: REGISTRY },
          children: [paragraph('Brand Sans')],
        } as any,
        {}
      )
    ).resolves.toBeInstanceOf(Buffer);
  });

  it('still warns for a family the registry does not declare', async () => {
    const warnings = await warningsFor({
      name: 'docx',
      props: { theme: 'minimal', fontRegistry: REGISTRY },
      children: [paragraph('Brand Sans'), paragraph('Totally Unknown')],
    });
    const hits = unresolved(warnings);
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain('Totally Unknown');
  });

  it('does not treat the registry itself as a font reference', async () => {
    // The entry's own family and its kind:'google' source family must not
    // register as references — a document that uses no fonts should produce
    // no font warnings even while declaring a registry.
    const warnings = await warningsFor({
      name: 'docx',
      props: { theme: 'minimal', fontRegistry: REGISTRY },
      children: [{ name: 'paragraph', props: { text: 'Body.' } }],
    });
    expect(unresolved(warnings)).toEqual([]);
  });

  it('resolves a family declared by a theme-level fontRegistry', async () => {
    const warnings: GenerationWarning[] = [];
    await generateBufferFromJson(
      {
        name: 'docx',
        props: { theme: 'branded' },
        children: [paragraph('Brand Sans')],
      } as any,
      { warnings, customThemes: { branded: brandedTheme() } }
    );
    expect(unresolved(warnings)).toEqual([]);
  });

  it('lets the document registry override the theme registry', async () => {
    // Both registries declare the SAME family, so "no FONT_UNRESOLVED" is
    // satisfied whichever entry wins — it would pass just as happily if the
    // theme entry silently outranked the document's. The resolved BYTES are
    // the seam that tells them apart, so each entry ships a marked inline
    // source and the winner names itself.
    const warnings: GenerationWarning[] = [];
    const resolved: ResolvedFont[] = [];
    const themed = {
      ...structuredClone(corporateTheme),
      fontRegistry: [
        {
          id: 'brand-sans',
          family: 'Brand Sans',
          sources: [markedSource('from-theme')],
        },
      ],
    } as never;

    await generateBufferFromJson(
      {
        name: 'docx',
        props: {
          theme: 'branded',
          fontRegistry: [
            {
              id: 'brand-sans',
              family: 'Brand Sans',
              sources: [markedSource('from-document')],
            },
          ],
        },
        children: [paragraph('Brand Sans')],
      } as any,
      {
        warnings,
        customThemes: { branded: themed },
        // Registering a listener is what makes resolution materialize sources
        // at all — without it resolveDocumentFonts stops after validation and
        // there is nothing to observe.
        fonts: { onResolved: (fonts) => resolved.push(...fonts) },
      }
    );

    expect(unresolved(warnings)).toEqual([]);
    const brandSans = resolved.find((f) => f.family === 'Brand Sans');
    expect(brandSans?.sources).toHaveLength(1);
    expect(brandSans!.sources[0].data.toString('utf8')).toContain(
      'from-document'
    );
  });
});
