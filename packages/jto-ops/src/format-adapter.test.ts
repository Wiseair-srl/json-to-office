import { describe, expect, it } from 'vitest';
import { Type } from '@sinclair/typebox';
import { createComponent, createVersion } from '@json-to-office/core-docx';
import {
  createComponent as createPptxComponent,
  createVersion as createPptxVersion,
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
    const generator = await adapter.createGenerator([], { theme: 'modern' });

    const requested = await generator.generateBuffer(report('corporate'));
    const modern = await adapter.generateBuffer(report('modern'), {});
    const corporate = await adapter.generateBuffer(report('corporate'), {});

    expect(requested.equals(modern)).toBe(true);
    expect(requested.equals(corporate)).toBe(false);
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
        await generator.generateBuffer(report('corporate'));
        await generator.generateBuffer(report('corporate'));
        await generator.generateBuffer(report('corporate'));
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

    const untouched = await generator.generateBuffer(report('corporate'));
    const corporate = await adapter.generateBuffer(report('corporate'), {});
    const modern = await adapter.generateBuffer(report('modern'), {});

    expect(untouched.equals(corporate)).toBe(true);
    expect(untouched.equals(modern)).toBe(false);
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

    const corporate = await generator.generateBuffer(report('corporate'));
    const modern = await generator.generateBuffer(report('modern'));
    const withoutPlugins = await (
      await adapter.createGenerator([], {})
    ).generateBuffer(report('corporate'));

    expect(corporate.equals(modern)).toBe(false);
    expect(corporate.equals(withoutPlugins)).toBe(true);
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
      theme: 'corporate',
    });

    const requested = await generator.generateBuffer(report('modern'));
    const own = await (
      await adapter.createGenerator([docxPlugin], {})
    ).generateBuffer(report('corporate'));

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
