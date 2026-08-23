/**
 * Entry-point parity for PPTX, mirroring the DOCX suite.
 *
 * `generateBufferFromJson` and `createPresentationGenerator` share the
 * generation prologue — theme resolution (including inline theme objects),
 * export-mode pre-pass — via
 * `core/generationContext.ts` (#134). In DOCX the duplicated prologue
 * silently dropped a root-level prop from the plugin path (#133); these
 * tests fail the moment the two entry points disagree about a document.
 */
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { generateBufferFromJson } from '../core/generator';
import { createPresentationGenerator } from '../plugin/createPresentationGenerator';

async function slideXml(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const entry = zip.file('ppt/slides/slide1.xml');
  if (!entry) throw new Error('ppt/slides/slide1.xml missing');
  return entry.async('string');
}

async function bothPipelines(doc: unknown): Promise<[string, string]> {
  const viaCore = await generateBufferFromJson(
    structuredClone(doc) as never,
    {}
  );
  const viaPlugin = await createPresentationGenerator({}).generateBuffer(
    structuredClone(doc) as never
  );
  return [
    await slideXml(viaCore as Buffer),
    await slideXml(
      (viaPlugin as { buffer: Buffer }).buffer ?? (viaPlugin as Buffer)
    ),
  ];
}

const deck = (theme: unknown) => ({
  name: 'pptx',
  props: {
    theme,
    slideWidth: 13.333,
    slideHeight: 7.5,
  },
  children: [
    {
      name: 'slide',
      props: { notes: 'parity' },
      children: [
        {
          name: 'text',
          props: {
            text: 'Token',
            x: 1,
            y: 1,
            w: 6,
            h: 1,
            fontSize: 24,
            color: 'primary',
          },
        },
        {
          name: 'shape',
          props: {
            type: 'rect',
            x: 1,
            y: 3,
            w: 4,
            h: 2,
            fill: { color: 'accent' },
          },
        },
      ],
    },
  ],
});

describe('generateBufferFromJson vs createPresentationGenerator', () => {
  it('resolves a built-in theme name identically', async () => {
    const [core, plugin] = await bothPipelines(deck('minimal'));
    expect(plugin).toEqual(core);
  });

  it('resolves an inline theme object identically', async () => {
    // The inline-theme branch is the piece each prologue implements separately.
    const [core, plugin] = await bothPipelines(
      deck({
        name: 'parity-inline',
        colors: {
          primary: '#231F20',
          secondary: '#595959',
          accent: '#E6E620',
          background: '#FFFFFF',
          text: '#000000',
        },
        fonts: { heading: 'Georgia', body: 'Georgia' },
        defaults: { fontSize: 18, fontColor: '#000000' },
      })
    );
    expect(plugin).toContain('231F20');
    expect(plugin).toContain('E6E620');
    expect(plugin).toEqual(core);
  });
});

describe('substitute-mode theme delivery', () => {
  // The resolved theme reaches processPresentation by value. Before #135 it
  // travelled by name — rewritten `props.theme` + a scoped customThemes
  // entry — and a miss meant slide processing silently re-resolved a fresh,
  // pre-substitute theme. This is the regression that fails if the handover
  // is ever wired wrong: the non-safe family must not reach the slide XML.
  it('renders substituted families identically on both paths', async () => {
    const inter = deck({
      name: 'subst-parity',
      colors: {
        primary: '#231F20',
        secondary: '#595959',
        accent: '#E6E620',
        background: '#FFFFFF',
        text: '#000000',
      },
      fonts: { heading: 'Inter', body: 'Inter' },
      defaults: { fontSize: 18, fontColor: '#000000' },
    });
    const fonts = { mode: 'substitute' as const };

    const viaCore = await generateBufferFromJson(
      structuredClone(inter) as never,
      { fonts }
    );
    const { buffer: viaPlugin } = await createPresentationGenerator({
      fonts,
    }).generateBuffer(structuredClone(inter) as never);

    const core = await slideXml(viaCore as Buffer);
    const plugin = await slideXml(viaPlugin);
    expect(core).not.toContain('typeface="Inter"');
    expect(core).toContain('typeface="Calibri"');
    expect(plugin).toEqual(core);
  });
});

describe('root props defaulting', () => {
  // The PPTX validator rejects a missing root `props`, so the divergence
  // lived behind `validation: { enabled: false }`: the core path died with a
  // raw TypeError inside processPresentation, the plugin path with one at its
  // first `props.theme` read. The shared context defaults `props: {}`
  // (`undefined` only) so both render with the default theme instead.
  const V_OFF = { validation: { enabled: false as const } };
  const noProps = () => ({
    name: 'pptx',
    children: [
      {
        name: 'slide',
        props: {},
        children: [
          {
            name: 'text',
            props: { text: 'No root props', x: 1, y: 1, w: 6, h: 1 },
          },
        ],
      },
    ],
  });

  it('renders a document with no root props identically on both paths', async () => {
    const viaCore = await generateBufferFromJson(noProps() as never, V_OFF);
    const { buffer: viaPlugin } = await createPresentationGenerator(
      V_OFF
    ).generateBuffer(noProps() as never);
    const core = await slideXml(viaCore as Buffer);
    const plugin = await slideXml(viaPlugin);
    expect(core).toContain('No root props');
    expect(plugin).toEqual(core);
  });

  it('rejects props: null with the same clear message, not a TypeError', async () => {
    const doc = { ...noProps(), props: null };
    await expect(
      generateBufferFromJson(structuredClone(doc) as never, V_OFF)
    ).rejects.toThrow(/props` is null/);
    await expect(
      createPresentationGenerator(V_OFF).generateBuffer(
        structuredClone(doc) as never
      )
    ).rejects.toThrow(/props` is null/);
  });
});

describe('image-source / text-content conflict gate', () => {
  // Structural conflicts (image path+base64, text text+runs) are collected by
  // both validators, so with validation off only the core path used to reject
  // them — the plugin path handed the conflict to the renderer, which resolved
  // it by runtime precedence. Both paths now run the same unconditional gate;
  // the plugin runs it on the expanded tree, the tree that actually reaches
  // the renderer, so payloads emitted by custom components are held to the
  // same rules as authored ones.
  const V_OFF = { validation: { enabled: false as const } };
  const conflicted = () => ({
    name: 'pptx',
    props: { theme: 'minimal' },
    children: [
      {
        name: 'slide',
        props: {},
        children: [
          {
            name: 'image',
            props: {
              path: 'a.png',
              base64:
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
              x: 1,
              y: 1,
              w: 2,
              h: 2,
            },
          },
        ],
      },
    ],
  });

  it('rejects conflicting image sources on both paths with validation off', async () => {
    await expect(
      generateBufferFromJson(structuredClone(conflicted()) as never, V_OFF)
    ).rejects.toThrow(/Document validation failed/);
    await expect(
      createPresentationGenerator(V_OFF).generateBuffer(
        structuredClone(conflicted()) as never
      )
    ).rejects.toThrow(/Document validation failed/);
  });

  it('rejects a conflict emitted by a custom component', async () => {
    // Authored tree is clean — the conflict only exists after expansion, so
    // only the expanded-tree gate can see it.
    const gen = createPresentationGenerator(V_OFF).addComponent({
      name: 'badImage',
      versions: {
        '1.0.0': {
          propsSchema: { type: 'object', properties: {} } as never,
          render: () => ({
            name: 'image',
            props: {
              path: 'a.png',
              base64:
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
              x: 1,
              y: 1,
              w: 2,
              h: 2,
            },
          }),
        },
      },
    } as never);
    await expect(
      gen.generateBuffer({
        name: 'pptx',
        props: { theme: 'minimal' },
        children: [
          {
            name: 'slide',
            props: {},
            children: [{ name: 'badImage', props: {} }],
          },
        ],
      } as never)
    ).rejects.toThrow(/Document validation failed/);
  });
});

describe('constructor default theme', () => {
  // A constructor-supplied string theme fills in when the document names no
  // theme. Before the shared context, the injected customThemes entry was
  // keyed under that name while `props.theme` stayed undefined, so slide
  // processing re-resolved to 'default' — fonts resolved against the
  // constructor theme, slides rendered without it. The context normalizes
  // `props.theme` to the effective name, closing the gap.
  it('applies a constructor string theme naming a customThemes entry', async () => {
    const corporate = {
      name: 'corporate',
      colors: {
        primary: '#112233',
        secondary: '#445566',
        accent: '#AB12CD',
        background: '#FFFFFF',
        text: '#101010',
      },
      fonts: { heading: 'Georgia', body: 'Georgia' },
      defaults: { fontSize: 18, fontColor: '#101010' },
    };
    const { buffer } = await createPresentationGenerator({
      theme: 'corporate',
      customThemes: { corporate },
    }).generateBuffer({
      name: 'pptx',
      props: {},
      children: [
        {
          name: 'slide',
          props: {},
          children: [
            {
              name: 'text',
              props: { text: 'T', x: 1, y: 1, w: 4, h: 1, color: 'accent' },
            },
          ],
        },
      ],
    } as never);
    expect(await slideXml(buffer)).toContain('AB12CD');
  });

  // Constructor OBJECT precedence — plugin-only semantics (core has no
  // constructor-theme input), pinned here so a change is a conscious decision:
  // a document explicitly naming a known built-in gets it; the object fills
  // in when the doc names nothing or names something nothing recognizes
  // (#141), matching the DOCX plugin's resolveDocumentTheme.
  const ctorObject = {
    name: 'app-theme',
    colors: {
      primary: '#112233',
      secondary: '#445566',
      accent: '#0FA958',
      background: '#FFFFFF',
      text: '#101010',
    },
    fonts: { heading: 'Georgia', body: 'Georgia' },
    defaults: { fontSize: 18, fontColor: '#101010' },
  };
  const accentText = (theme?: unknown) => ({
    name: 'pptx',
    props: theme === undefined ? {} : { theme },
    children: [
      {
        name: 'slide',
        props: {},
        children: [
          {
            name: 'text',
            props: { text: 'T', x: 1, y: 1, w: 4, h: 1, color: 'accent' },
          },
        ],
      },
    ],
  });

  it('a doc-named built-in beats the constructor theme object (#141)', async () => {
    const { buffer } = await createPresentationGenerator({
      theme: ctorObject,
    }).generateBuffer(accentText('minimal') as never);
    // themes.minimal accent, not the constructor object's
    expect(await slideXml(buffer)).toContain('999999');
  });

  it('constructor theme object applies when the doc names no theme', async () => {
    const { buffer } = await createPresentationGenerator({
      theme: ctorObject,
    }).generateBuffer(accentText() as never);
    expect(await slideXml(buffer)).toContain('0FA958');
  });

  it('a customThemes entry sharing a built-in name still wins', async () => {
    const { buffer } = await createPresentationGenerator({
      theme: ctorObject,
      customThemes: {
        minimal: { ...ctorObject, name: 'minimal' },
      },
    }).generateBuffer(accentText('minimal') as never);
    expect(await slideXml(buffer)).toContain('0FA958');
  });

  it('constructor theme object fills in for a doc-named unknown theme', async () => {
    // The playground/CLI fallback: getPptxTheme never misses (it falls back
    // to the default theme), so without this rule an unknown name would
    // silently render default instead of the app's theme.
    const { buffer } = await createPresentationGenerator({
      theme: ctorObject,
    }).generateBuffer(accentText('wiseair') as never);
    expect(await slideXml(buffer)).toContain('0FA958');
  });
});
