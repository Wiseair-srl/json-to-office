import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Type } from '@sinclair/typebox';
import { createComponent, createVersion } from '@json-to-office/core-docx';
import {
  createComponent as createPptxComponent,
  createVersion as createPptxVersion,
  pptxThemes,
} from '@json-to-office/core-pptx';
import type { GenerationWarning } from '@json-to-office/shared';
import { DocxFormatAdapter, PptxFormatAdapter } from './format-adapter';
import { runWithDiagnosticSink } from './diagnostics.js';

function deck(textProps: Record<string, unknown>) {
  return {
    name: 'pptx',
    props: {},
    children: [
      {
        name: 'slide',
        props: {},
        children: [{ name: 'text', props: textProps }],
      },
    ],
  };
}

describe('PptxFormatAdapter.validateDocument', () => {
  it('accepts a valid presentation', () => {
    const result = new PptxFormatAdapter().validateDocument(
      deck({ text: 'Hello' })
    );

    expect(result).toEqual({ valid: true });
  });

  it('returns deep schema errors instead of hardcoded success', () => {
    const result = new PptxFormatAdapter().validateDocument(
      deck({ text: 'Hello', fontColor: 'CC785C' })
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: expect.stringContaining('/children/0/children/0/props'),
          message: expect.stringMatching(/fontColor/),
        }),
      ])
    );
  });

  it('uses the root renderer profile and the omitted default', () => {
    const transition = {
      ...deck({ text: 'Hello' }),
      children: [
        {
          name: 'slide',
          props: { transition: { type: 'fade' } },
          children: [],
        },
      ],
    };
    const adapter = new PptxFormatAdapter();

    expect(adapter.validateDocument(transition).valid).toBe(false);
    expect(
      adapter.validateDocument({ ...transition, renderer: 'office-open' }).valid
    ).toBe(true);
  });
});

describe('PptxFormatAdapter.analyzeQuality', () => {
  it('resolves the same custom theme options as generation', async () => {
    const tinyTheme = {
      ...pptxThemes.minimal,
      name: 'tiny',
      defaults: { ...pptxThemes.minimal.defaults, fontSize: 6 },
    };
    const document = {
      ...deck({ text: 'Unreadable by theme' }),
      props: {
        theme: 'tiny',
        slideWidth: 13.333,
        slideHeight: 7.5,
      },
    };

    const analysis = await new PptxFormatAdapter().analyzeQuality(document, {
      customThemes: { tiny: tinyTheme },
    });
    expect(analysis.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'W_QUALITY_FONT_SIZE_MIN' }),
      ])
    );
  });
});

describe('prepared document reuse', () => {
  it('shares one canonical DOCX model with analysis and rendering', async () => {
    const adapter = new DocxFormatAdapter();
    const document = {
      name: 'docx',
      props: { theme: 'minimal' },
      children: [{ name: 'paragraph', props: { text: 'Prepared once.' } }],
    };
    const prepared = await adapter.prepareDocument(document);
    expect(prepared.renderer).toBe('docxjs');
    const analysis = await adapter.analyzeQuality(document, { prepared });
    const direct = await adapter.generateBuffer(document, {
      deterministic: true,
    });
    const reused = await adapter.generateBuffer(document, {
      deterministic: true,
      prepared,
    });
    const generator = await adapter.createGenerator([], {
      deterministic: true,
      prepared,
    });
    const reusedByGenerator = await generator.generateBuffer(document);

    expect(analysis.ruleErrors).toEqual([]);
    expect(reused.equals(direct)).toBe(true);
    expect(reusedByGenerator.equals(direct)).toBe(true);
  });

  it('shares one canonical PPTX model with analysis and rendering', async () => {
    const adapter = new PptxFormatAdapter();
    const document = {
      ...deck({ text: 'Prepared once.', x: 1, y: 1, w: 4, h: 1 }),
      props: { slideWidth: 13.333, slideHeight: 7.5 },
    };
    const prepared = await adapter.prepareDocument(document);
    expect(prepared.renderer).toBe('pptxgenjs');
    const analysis = await adapter.analyzeQuality(document, { prepared });
    const direct = await adapter.generateBuffer(document, {
      deterministic: true,
    });
    const reused = await adapter.generateBuffer(document, {
      deterministic: true,
      prepared,
    });
    const generator = await adapter.createGenerator([], {
      deterministic: true,
      prepared,
    });
    const reusedByGenerator = await generator.generateBuffer(document);

    expect(analysis.ruleErrors).toEqual([]);
    expect(reused.equals(direct)).toBe(true);
    expect(reusedByGenerator.equals(direct)).toBe(true);
  });

  /** A prepared model that is not this document's must never render instead. */
  const docA = {
    name: 'docx',
    props: { theme: 'minimal' },
    children: [{ name: 'paragraph', props: { text: 'Document A.' } }],
  };
  const docB = {
    name: 'docx',
    props: { theme: 'minimal' },
    children: [{ name: 'paragraph', props: { text: 'Document B.' } }],
  };

  it('ignores a DOCX prepared model built from another document', async () => {
    const adapter = new DocxFormatAdapter();
    const prepared = await adapter.prepareDocument(docA);

    const stale = await adapter.generateBuffer(docB, {
      deterministic: true,
      prepared,
    });
    const generator = await adapter.createGenerator([], {
      deterministic: true,
      prepared,
    });
    const staleByGenerator = await generator.generateBuffer(docB);
    const expected = await adapter.generateBuffer(docB, {
      deterministic: true,
    });
    const renderedA = await adapter.generateBuffer(docA, {
      deterministic: true,
    });

    expect(stale.equals(expected)).toBe(true);
    expect(staleByGenerator.equals(expected)).toBe(true);
    expect(expected.equals(renderedA)).toBe(false);
  });

  const deckA = {
    ...deck({ text: 'Deck A.', x: 1, y: 1, w: 4, h: 1 }),
    props: { slideWidth: 13.333, slideHeight: 7.5 },
  };
  const deckB = {
    ...deck({ text: 'Deck B.', x: 1, y: 1, w: 4, h: 1 }),
    props: { slideWidth: 13.333, slideHeight: 7.5 },
  };

  it('ignores a PPTX prepared model built from another document', async () => {
    const adapter = new PptxFormatAdapter();
    const prepared = await adapter.prepareDocument(deckA);

    const stale = await adapter.generateBuffer(deckB, {
      deterministic: true,
      prepared,
    });
    const generator = await adapter.createGenerator([], {
      deterministic: true,
      prepared,
    });
    const staleByGenerator = await generator.generateBuffer(deckB);
    const expected = await adapter.generateBuffer(deckB, {
      deterministic: true,
    });
    const renderedA = await adapter.generateBuffer(deckA, {
      deterministic: true,
    });

    expect(stale.equals(expected)).toBe(true);
    expect(staleByGenerator.equals(expected)).toBe(true);
    expect(expected.equals(renderedA)).toBe(false);
  });

  it('still applies the requested theme to the document it is handed', async () => {
    const adapter = new DocxFormatAdapter();
    // Prepared from one object, rendered from an equal but distinct one.
    const prepared = await adapter.prepareDocument(report('devportal'), {
      theme: 'vermilion',
    });
    const generator = await adapter.createGenerator([], {
      theme: 'vermilion',
      deterministic: true,
      prepared,
    });

    const rendered = await generator.generateBuffer(report('devportal'));
    const vermilion = await adapter.generateBuffer(report('vermilion'), {
      deterministic: true,
    });

    expect(rendered.equals(vermilion)).toBe(true);
  });
});

describe('renderer identity', () => {
  it("prepares a DOCX model for the document's own renderer", async () => {
    const adapter = new DocxFormatAdapter();

    const own = await adapter.prepareDocument({
      ...report(),
      renderer: 'office-open',
    });
    const overridden = await adapter.prepareDocument(
      { ...report(), renderer: 'office-open' },
      { renderer: 'docxjs' }
    );

    expect(own.renderer).toBe('office-open');
    expect(overridden.renderer).toBe('docxjs');
  });

  it("prepares a PPTX model for the document's own renderer", async () => {
    const adapter = new PptxFormatAdapter();

    const own = await adapter.prepareDocument({
      ...themedDeck(),
      renderer: 'office-open',
    });
    const overridden = await adapter.prepareDocument(
      { ...themedDeck(), renderer: 'office-open' },
      { renderer: 'pptxgenjs' }
    );

    expect(own.renderer).toBe('office-open');
    expect(overridden.renderer).toBe('pptxgenjs');
  });

  it('accepts a renderer-targeted profile the document qualifies for', async () => {
    const analysis = await new DocxFormatAdapter().analyzeQuality(
      { ...report(), renderer: 'office-open' },
      {
        quality: {
          profile: {
            id: 'oo-only',
            formats: ['docx'],
            rendererTargets: ['office-open'],
          },
        },
      }
    );

    expect(analysis.ruleErrors).toEqual([]);
  });
});

describe('DocxFormatAdapter.validateDocument', () => {
  it('returns real schema errors', () => {
    const result = new DocxFormatAdapter().validateDocument({
      name: 'docx',
      props: { unknown: true },
      children: [],
    });

    expect(result.valid).toBe(false);
    expect(result.errors?.length).toBeGreaterThan(0);
  });

  it('uses the root renderer profile and the omitted default', () => {
    const threaded = {
      name: 'docx',
      props: {},
      children: [
        {
          name: 'paragraph',
          props: {
            text: 'Hello',
            comment: {
              text: 'Parent',
              replies: [{ text: 'Reply' }],
            },
          },
        },
      ],
    };
    const adapter = new DocxFormatAdapter();

    expect(adapter.validateDocument(threaded).valid).toBe(true);
    expect(
      adapter.validateDocument({ ...threaded, renderer: 'office-open' }).valid
    ).toBe(false);
  });
});

function report(theme?: string) {
  return {
    name: 'docx',
    props: theme ? { theme } : {},
    children: [{ name: 'paragraph', props: { text: 'Hello' } }],
  };
}

function themedDeck(theme?: string) {
  return {
    name: 'pptx',
    props: theme ? { theme } : {},
    children: [
      {
        name: 'slide',
        props: {},
        children: [{ name: 'text', props: { text: 'Hello' } }],
      },
    ],
  };
}

describe('requested theme wins over props.theme', () => {
  it('applies the theme on the docx path without plugins', async () => {
    const adapter = new DocxFormatAdapter();
    const generator = await adapter.createGenerator([], { theme: 'vermilion' });

    const requested = await generator.generateBuffer(report('devportal'));
    const vermilion = await adapter.generateBuffer(report('vermilion'), {});
    const devportal = await adapter.generateBuffer(report('devportal'), {});

    expect(requested.equals(vermilion)).toBe(true);
    expect(requested.equals(devportal)).toBe(false);
  });

  it('applies the theme on the pptx path without plugins', async () => {
    const adapter = new PptxFormatAdapter();
    const generator = await adapter.createGenerator([], { theme: 'default' });

    const requested = await generator.generateBuffer(themedDeck('dark'));
    const fallback = await adapter.generateBuffer(themedDeck('default'), {});
    const dark = await adapter.generateBuffer(themedDeck('dark'), {});

    expect(requested.equals(fallback)).toBe(true);
    expect(requested.equals(dark)).toBe(false);
  });

  it('keeps props.theme when the requested pptx theme is unknown', async () => {
    const adapter = new PptxFormatAdapter();
    const generator = await adapter.createGenerator([], { theme: 'no-such' });

    const unknown = await generator.generateBuffer(themedDeck('dark'));
    const dark = await adapter.generateBuffer(themedDeck('dark'), {});

    expect(unknown.equals(dark)).toBe(true);
  });

  it('warns once about an unknown docx theme across repeated generations', async () => {
    const adapter = new DocxFormatAdapter();
    const warnings: string[] = [];

    await runWithDiagnosticSink(
      (text) => warnings.push(text),
      async () => {
        const generator = await adapter.createGenerator([], {
          theme: 'no-such-theme',
        });
        await generator.generateBuffer(report('devportal'));
        await generator.generateBuffer(report('devportal'));
        await generator.generateBuffer(report('devportal'));
      }
    );

    expect(
      warnings.filter((text) => text.includes('no-such-theme'))
    ).toHaveLength(1);
  });

  it('warns once about an unknown pptx theme across repeated generations', async () => {
    const adapter = new PptxFormatAdapter();
    const warnings: string[] = [];

    await runWithDiagnosticSink(
      (text) => warnings.push(text),
      async () => {
        const generator = await adapter.createGenerator([], {
          theme: 'no-such-theme',
        });
        await generator.generateBuffer(themedDeck('dark'));
        await generator.generateBuffer(themedDeck('dark'));
        await generator.generateBuffer(themedDeck('dark'));
      }
    );

    expect(
      warnings.filter((text) => text.includes('no-such-theme'))
    ).toHaveLength(1);
  });

  it('leaves props.theme in charge when no theme is requested', async () => {
    const adapter = new DocxFormatAdapter();
    const generator = await adapter.createGenerator([], {});

    const untouched = await generator.generateBuffer(report('devportal'));
    const devportal = await adapter.generateBuffer(report('devportal'), {});
    const vermilion = await adapter.generateBuffer(report('vermilion'), {});

    expect(untouched.equals(devportal)).toBe(true);
    expect(untouched.equals(vermilion)).toBe(false);
  });

  it('refuses a malformed pptx theme file instead of handing it to the renderer', async () => {
    // The pptx branch used to do bare readFileSync + JSON.parse where the docx
    // branch calls loadThemeFromFile, so a theme with the wrong shape reached
    // the IR compiler and failed there as a TypeError on an unguarded read —
    // a stack trace instead of a diagnostic naming the field.
    const dir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'jto-theme-path-')
    );
    const file = path.join(dir, 'broken.pptx.theme.json');
    await fs.promises.writeFile(
      file,
      JSON.stringify({ name: 'broken', colors: { primary: 'not-a-colour' } })
    );

    const warnings: string[] = [];
    const resolved = await runWithDiagnosticSink(
      (text) => warnings.push(text),
      async () =>
        new PptxFormatAdapter().createGenerator([], { themePath: file })
    );

    expect(
      warnings.some((text) => text.includes('broken.pptx.theme.json')),
      warnings.join(' | ')
    ).toBe(true);
    // The document keeps its own theme rather than rendering under a broken one.
    expect(resolved.themeLabel).not.toBe(file);

    await fs.promises.rm(dir, { recursive: true, force: true });
  });

  it('accepts a well-formed pptx theme file', async () => {
    const dir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'jto-theme-path-ok-')
    );
    const file = path.join(dir, 'good.pptx.theme.json');
    await fs.promises.writeFile(
      file,
      JSON.stringify({
        name: 'good',
        colors: {
          primary: '#123456',
          secondary: '#234567',
          accent: '#345678',
          background: '#FFFFFF',
          text: '#000000',
        },
        fonts: { heading: 'Arial', body: 'Arial' },
        defaults: { fontSize: 18, fontColor: '#000000' },
      })
    );

    const resolved = await new PptxFormatAdapter().createGenerator([], {
      themePath: file,
    });
    expect(resolved.themeLabel).toBe(file);

    await fs.promises.rm(dir, { recursive: true, force: true });
  });

  it('reads a themePath once, so a bad path warns once per generator', async () => {
    const warnings: string[] = [];

    await runWithDiagnosticSink(
      (text) => warnings.push(text),
      async () => {
        await new DocxFormatAdapter().createGenerator([], {
          themePath: './definitely-missing.json',
        });
        await new PptxFormatAdapter().createGenerator([], {
          themePath: './definitely-missing.json',
        });
      }
    );

    expect(
      warnings.filter((text) => text.includes('definitely-missing.json'))
    ).toHaveLength(2);
  });
});

/** Plugins the CLI would load; neither is referenced by the test documents. */
const docxPlugin = createComponent({
  name: 'noop-docx',
  versions: {
    '1.0.0': createVersion({
      propsSchema: Type.Object({}, { additionalProperties: false }),
      render: async () => [],
    }),
  },
});

const pptxPlugin = createPptxComponent({
  name: 'noop-pptx',
  versions: {
    '1.0.0': createPptxVersion({
      propsSchema: Type.Object({}, { additionalProperties: false }),
      render: async () => [],
    }),
  },
});

describe('plugins do not restyle the document', () => {
  it('keeps props.theme in charge on the docx plugin path', async () => {
    const adapter = new DocxFormatAdapter();
    const generator = await adapter.createGenerator([docxPlugin], {});

    const devportal = await generator.generateBuffer(report('devportal'));
    const vermilion = await generator.generateBuffer(report('vermilion'));
    const withoutPlugins = await (
      await adapter.createGenerator([], {})
    ).generateBuffer(report('devportal'));

    expect(devportal.equals(vermilion)).toBe(false);
    expect(devportal.equals(withoutPlugins)).toBe(true);
  });

  it('keeps props.theme in charge on the pptx plugin path', async () => {
    const adapter = new PptxFormatAdapter();
    const generator = await adapter.createGenerator([pptxPlugin], {});

    const dark = await generator.generateBuffer(themedDeck('dark'));
    const fallback = await generator.generateBuffer(themedDeck('default'));
    const withoutPlugins = await (
      await adapter.createGenerator([], {})
    ).generateBuffer(themedDeck('dark'));

    expect(dark.equals(fallback)).toBe(false);
    expect(dark.equals(withoutPlugins)).toBe(true);
  });

  it('still lets an explicit docx theme win over props.theme', async () => {
    const adapter = new DocxFormatAdapter();
    const generator = await adapter.createGenerator([docxPlugin], {
      theme: 'devportal',
    });

    const requested = await generator.generateBuffer(report('vermilion'));
    const own = await (
      await adapter.createGenerator([docxPlugin], {})
    ).generateBuffer(report('devportal'));

    expect(requested.equals(own)).toBe(true);
  });

  it('still lets an explicit pptx theme win over props.theme', async () => {
    const adapter = new PptxFormatAdapter();
    const generator = await adapter.createGenerator([pptxPlugin], {
      theme: 'dark',
    });

    const requested = await generator.generateBuffer(themedDeck('default'));
    const own = await (
      await adapter.createGenerator([pptxPlugin], {})
    ).generateBuffer(themedDeck('dark'));

    expect(requested.equals(own)).toBe(true);
  });
});

/**
 * `emitGenerationWarnings` writes to an AsyncLocalStorage diagnostic sink that
 * only the CLI installs — off the CLI it is a no-op, so core warnings had no
 * way of reaching the playground. `GeneratorOptions.warnings` is the array
 * sink that carries them out.
 *
 * The family is deliberately one that is neither in SAFE_FONTS nor in
 * POPULAR_GOOGLE_FONTS, so validation actually flags it.
 */
const UNKNOWN_FAMILY = 'Acme Brand Sans';

function reportWithFont(family: string) {
  return {
    name: 'docx',
    props: { theme: 'minimal' },
    children: [
      { name: 'paragraph', props: { text: 'Body.', font: { family } } },
    ],
  };
}

function deckWithFont(family: string) {
  return {
    name: 'pptx',
    props: {},
    children: [
      {
        name: 'slide',
        props: {},
        children: [
          { name: 'text', props: { text: 'Body.', fontFace: family } },
        ],
      },
    ],
  };
}

const unresolved = (warnings: GenerationWarning[]) =>
  warnings.filter((w) => w.context?.code === 'FONT_UNRESOLVED');

describe('generation warnings sink', () => {
  it('fills the sink on the docx path without plugins', async () => {
    const warnings: GenerationWarning[] = [];

    await new DocxFormatAdapter().generateBuffer(
      reportWithFont(UNKNOWN_FAMILY),
      { warnings }
    );

    const hits = unresolved(warnings);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].component).toBe('fontRegistry');
    expect(hits[0].message).toContain(UNKNOWN_FAMILY);
  });

  it('fills the sink on the docx createGenerator path', async () => {
    const warnings: GenerationWarning[] = [];
    const generator = await new DocxFormatAdapter().createGenerator([], {
      warnings,
    });

    await generator.generateBuffer(reportWithFont(UNKNOWN_FAMILY));

    expect(unresolved(warnings).length).toBeGreaterThan(0);
  });

  it('fills the sink on the pptx path without plugins', async () => {
    const warnings: GenerationWarning[] = [];

    await new PptxFormatAdapter().generateBuffer(deckWithFont(UNKNOWN_FAMILY), {
      warnings,
    });

    const hits = unresolved(warnings);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].message).toContain(UNKNOWN_FAMILY);
  });

  it('fills the sink on the pptx createGenerator path', async () => {
    const warnings: GenerationWarning[] = [];
    const generator = await new PptxFormatAdapter().createGenerator([], {
      warnings,
    });

    await generator.generateBuffer(deckWithFont(UNKNOWN_FAMILY));

    expect(unresolved(warnings).length).toBeGreaterThan(0);
  });

  it('normalizes pptx PipelineWarnings into the client-facing shape', async () => {
    const warnings: GenerationWarning[] = [];

    await new PptxFormatAdapter().generateBuffer(deckWithFont(UNKNOWN_FAMILY), {
      warnings,
    });

    expect(warnings.length).toBeGreaterThan(0);
    for (const w of warnings) {
      // A raw PipelineWarning has no `severity` and may have no `component` —
      // both would render as an empty chip in the playground's WarningsPanel.
      expect(typeof w.component).toBe('string');
      expect(w.component.length).toBeGreaterThan(0);
      expect(['warning', 'info']).toContain(w.severity);
      // `code` is promoted off PipelineWarning into `context`.
      expect(typeof w.context?.code).toBe('string');
    }
  });

  it('fills the sink on the docx plugin path', async () => {
    const warnings: GenerationWarning[] = [];
    const generator = await new DocxFormatAdapter().createGenerator(
      [docxPlugin],
      { warnings }
    );

    await generator.generateBuffer(reportWithFont(UNKNOWN_FAMILY));

    expect(unresolved(warnings).length).toBeGreaterThan(0);
  });

  it('fills the sink on the pptx plugin path', async () => {
    const warnings: GenerationWarning[] = [];
    const generator = await new PptxFormatAdapter().createGenerator(
      [pptxPlugin],
      { warnings }
    );

    await generator.generateBuffer(deckWithFont(UNKNOWN_FAMILY));

    expect(unresolved(warnings).length).toBeGreaterThan(0);
  });

  it('keeps the terminal output when a sink is also supplied', async () => {
    const warnings: GenerationWarning[] = [];
    const terminal: string[] = [];

    await runWithDiagnosticSink(
      (text) => terminal.push(text),
      async () => {
        await new DocxFormatAdapter().generateBuffer(
          reportWithFont(UNKNOWN_FAMILY),
          { warnings }
        );
      }
    );

    // Sink and terminal are additive, not exclusive.
    expect(unresolved(warnings).length).toBeGreaterThan(0);
    expect(
      terminal.filter((text) => text.includes(UNKNOWN_FAMILY)).length
    ).toBeGreaterThan(0);
  });

  it('accumulates across repeated generations on one generator', async () => {
    // Documented semantics: the sink is per logical request, never per call.
    const warnings: GenerationWarning[] = [];
    const generator = await new DocxFormatAdapter().createGenerator([], {
      warnings,
    });

    await generator.generateBuffer(reportWithFont(UNKNOWN_FAMILY));
    const afterFirst = unresolved(warnings).length;
    await generator.generateBuffer(reportWithFont(UNKNOWN_FAMILY));

    expect(unresolved(warnings).length).toBe(afterFirst * 2);
  });

  it('still returns a bare Buffer from every generate path', async () => {
    // Guards the six `.equals()` assertions above: widening the return type to
    // `{buffer, warnings}` would break four call sites outside this file.
    const docx = new DocxFormatAdapter();
    const pptx = new PptxFormatAdapter();

    expect(Buffer.isBuffer(await docx.generateBuffer(report(), {}))).toBe(true);
    expect(
      Buffer.isBuffer(
        await (await docx.createGenerator([], {})).generateBuffer(report())
      )
    ).toBe(true);
    expect(Buffer.isBuffer(await pptx.generateBuffer(themedDeck(), {}))).toBe(
      true
    );
    expect(
      Buffer.isBuffer(
        await (await pptx.createGenerator([], {})).generateBuffer(themedDeck())
      )
    ).toBe(true);
  });
});

/** A deck whose slide fills a placeholder its template never declared. */
function deckWithUnknownPlaceholder() {
  return {
    name: 'pptx',
    props: {
      slideWidth: 13.333,
      slideHeight: 7.5,
      templates: [
        {
          name: 'base',
          placeholders: [{ name: 'title', x: 0.5, y: 0.5, w: 8, h: 1 }],
        },
      ],
    },
    children: [
      {
        name: 'slide',
        props: {
          template: 'base',
          placeholders: {
            title: { name: 'text', props: { text: 'Declared' } },
            subtitle: { name: 'text', props: { text: 'Never declared' } },
          },
        },
        children: [],
      },
    ],
  };
}

const withCode = (warnings: GenerationWarning[], code: string) =>
  warnings.filter((w) => w.context?.code === code);

describe('preparation warnings', () => {
  it('forwards an unresolvable docx theme, and only once', async () => {
    const adapter = new DocxFormatAdapter();
    const warnings: GenerationWarning[] = [];
    const document = report('no-such-theme');

    const prepared = await adapter.prepareDocument(document, { warnings });
    await adapter.generateBuffer(document, { warnings, prepared });

    expect(withCode(warnings, 'theme_not_found')).toHaveLength(1);
  });

  it('reports an unknown pptx placeholder once across prepare and render', async () => {
    const adapter = new PptxFormatAdapter();
    const warnings: GenerationWarning[] = [];
    const document = deckWithUnknownPlaceholder();

    const prepared = await adapter.prepareDocument(document, { warnings });
    await adapter.generateBuffer(document, {
      warnings,
      prepared,
      deterministic: true,
    });

    expect(withCode(warnings, 'UNKNOWN_PLACEHOLDER')).toHaveLength(1);
  });

  it('still reports it when no prepared model is reused', async () => {
    const warnings: GenerationWarning[] = [];

    await new PptxFormatAdapter().generateBuffer(deckWithUnknownPlaceholder(), {
      warnings,
      deterministic: true,
    });

    // Only the prepare/render overlap is deduplicated: whatever the render
    // pipeline reports on its own is left exactly as it was.
    expect(withCode(warnings, 'UNKNOWN_PLACEHOLDER').length).toBeGreaterThan(0);
  });
});

describe('quality analysis of a malformed document', () => {
  const malformedReport = { name: 'docx', props: {}, children: 'not an array' };
  const malformedDeck = { name: 'pptx', props: null, children: [] };

  it('reports a docx preparation failure instead of throwing', async () => {
    const analysis = await new DocxFormatAdapter().analyzeQuality(
      malformedReport
    );

    expect(analysis.ruleErrors.map((error) => error.ruleId)).toContain(
      'quality/prepare'
    );
    expect(analysis.blocked).toBe(false);
  });

  it('reports a pptx preparation failure instead of throwing', async () => {
    const analysis = await new PptxFormatAdapter().analyzeQuality(
      malformedDeck
    );

    expect(analysis.ruleErrors.map((error) => error.ruleId)).toContain(
      'quality/prepare'
    );
    expect(analysis.blocked).toBe(false);
  });

  it('fails closed when a gate was requested', async () => {
    const gated = { quality: { policy: { gate: 'warning' as const } } };

    const docx = await new DocxFormatAdapter().analyzeQuality(
      malformedReport,
      gated
    );
    const pptx = await new PptxFormatAdapter().analyzeQuality(
      malformedDeck,
      gated
    );

    expect(docx.blocked).toBe(true);
    expect(pptx.blocked).toBe(true);
  });
});
