/**
 * Entry-point parity: `generateBufferFromJson` (core pipeline) and
 * `createDocumentGenerator` (plugin pipeline) share the structure→layout→render
 * engine but each own their prologue — props defaulting, theme resolution,
 * export mode, cache-key scoping. That duplication silently dropped
 * `props.themeOverrides` from the plugin path (issue #133); these tests assert
 * the two produce the same document so the next divergence fails here instead
 * of in a consumer that happens to register a plugin.
 */
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { generateBufferFromJson, generateDocument } from '../core/generator';
import { createDocumentGenerator } from './../plugin/createDocumentGenerator';
import { corporateTheme } from '../templates/themes';

/**
 * Both parts matter: run/paragraph colors land in document.xml, while theme
 * font roles only reach styles.xml — comparing document.xml alone would pass
 * even with theme merging disabled.
 */
async function parts(buf: Buffer): Promise<{ doc: string; styles: string }> {
  const zip = await JSZip.loadAsync(buf);
  const read = async (path: string) => {
    const entry = zip.file(path);
    if (!entry) throw new Error(`${path} missing`);
    return entry.async('string');
  };
  return {
    doc: await read('word/document.xml'),
    styles: await read('word/styles.xml'),
  };
}

/** Run one document through both entry points and return their package parts. */
async function bothPipelines(doc: unknown) {
  const viaCore = await generateBufferFromJson(
    structuredClone(doc) as never,
    {}
  );
  const viaPlugin = await createDocumentGenerator({}).generateBuffer(
    structuredClone(doc) as never
  );
  return {
    core: await parts(viaCore),
    plugin: await parts(
      (viaPlugin as { buffer: Buffer }).buffer ?? (viaPlugin as Buffer)
    ),
  };
}

const runColors = (xml: string): string[] => [
  ...new Set(
    [...xml.matchAll(/w:color w:val="([0-9A-Fa-f]{6})"/g)].map((m) => m[1])
  ),
];

function docWith(props: Record<string, unknown>, color: string) {
  return {
    name: 'docx',
    props: { theme: 'minimal', ...props },
    children: [
      {
        name: 'section',
        props: {},
        children: [
          {
            name: 'paragraph',
            props: { text: 'token', font: { color, size: 12 } },
          },
        ],
      },
    ],
  };
}

describe('generateBufferFromJson vs createDocumentGenerator', () => {
  it('resolves a themeOverrides slot that the base theme does not define', async () => {
    // accent4 is unset in `minimal`, so a pipeline that drops themeOverrides
    // throws "Invalid color value" rather than rendering the wrong color.
    const doc = docWith(
      { themeOverrides: { colors: { accent4: '#231F20' } } },
      'accent4'
    );
    const { core, plugin } = await bothPipelines(doc);
    expect(runColors(plugin.doc)).toEqual(['231F20']);
    expect(runColors(plugin.doc)).toEqual(runColors(core.doc));
  });

  it('resolves a themeOverrides slot that shadows a base-theme token', async () => {
    // The silent half: `primary` exists in `minimal`, so a pipeline that drops
    // themeOverrides renders 000000 with no error at all.
    const doc = docWith(
      { themeOverrides: { colors: { primary: '#231F20' } } },
      'primary'
    );
    const { core, plugin } = await bothPipelines(doc);
    expect(runColors(plugin.doc)).toEqual(['231F20']);
    expect(runColors(plugin.doc)).toEqual(runColors(core.doc));
  });

  it('applies font-role overrides identically', async () => {
    const doc = docWith(
      { themeOverrides: { fonts: { body: { family: 'Georgia' } } } },
      'primary'
    );
    const { core, plugin } = await bothPipelines(doc);
    expect(plugin.styles).toMatch(/w:rFonts [^>]*w:ascii="Georgia"/);
    expect(plugin.styles).toEqual(core.styles);
  });

  it('produces identical output with no overrides at all', async () => {
    const { core, plugin } = await bothPipelines(docWith({}, 'primary'));
    expect(plugin.doc).toEqual(core.doc);
    expect(plugin.styles).toEqual(core.styles);
  });
});

describe('root props defaulting', () => {
  // `props` is optional in the schema, but every downstream read assumes an
  // object. `generateDocument` on a document without `$schema` runs no
  // validator, so a null here used to surface as `Cannot read properties of
  // null (reading 'theme')` from deep inside theme resolution.
  it('accepts a document with no props at all', async () => {
    const doc = await generateDocument({
      name: 'docx',
      children: [{ name: 'paragraph', props: { text: 'No root props.' } }],
    } as never);
    expect(doc).toBeDefined();
  });

  it('rejects props: null with a clear message, not a TypeError', async () => {
    await expect(
      generateDocument({
        name: 'docx',
        props: null,
        children: [],
      } as never)
    ).rejects.toThrow(/props` is null/);
  });
});

describe('constructor theme precedence (#141)', () => {
  // Plugin-only semantics (core has no constructor-theme input), pinned here
  // so a change is a conscious decision: a document explicitly naming a known
  // built-in gets it; the constructor `theme` object fills in when the doc
  // names nothing or names something nothing recognizes. Mirrors the PPTX
  // pins in core-pptx/src/__tests__/pipeline-parity.test.ts.
  //
  // Signal: corporate's heading font is Georgia; minimal has no Georgia
  // anywhere, so its presence in styles.xml marks which theme rendered.
  const ctorTheme = () =>
    structuredClone(corporateTheme) as unknown as Parameters<
      typeof createDocumentGenerator
    >[0]['theme'];

  const headingDoc = (theme?: string) => ({
    name: 'docx',
    props: theme === undefined ? {} : { theme },
    children: [{ name: 'heading', props: { text: 'H', level: 1 } }],
  });

  async function stylesXml(doc: unknown, options: Record<string, unknown>) {
    const result = await createDocumentGenerator(options).generateBuffer(
      doc as never
    );
    return (await parts(result.buffer)).styles;
  }

  it('a doc-named built-in beats the constructor theme object', async () => {
    const styles = await stylesXml(headingDoc('minimal'), {
      theme: ctorTheme(),
    });
    expect(styles).not.toContain('Georgia');
  });

  it('constructor theme object applies when the doc names no theme', async () => {
    const styles = await stylesXml(headingDoc(), { theme: ctorTheme() });
    expect(styles).toContain('Georgia');
  });

  it('constructor theme object fills in for a doc-named unknown theme', async () => {
    // resolveBuiltInTheme never misses (it falls back to minimal), so without
    // this rule an unknown name would silently render minimal instead of the
    // app's theme.
    const styles = await stylesXml(headingDoc('wiseair'), {
      theme: ctorTheme(),
    });
    expect(styles).toContain('Georgia');
  });

  it('a customThemes entry sharing a built-in name still wins', async () => {
    const styles = await stylesXml(headingDoc('minimal'), {
      customThemes: { minimal: ctorTheme() },
    });
    expect(styles).toContain('Georgia');
  });
});
