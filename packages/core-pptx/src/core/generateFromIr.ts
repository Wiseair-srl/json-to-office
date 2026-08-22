/**
 * The IR-based PPTX generation path.
 *
 * Same prologue as `generateBufferWithWarnings` — props defaulting, inline
 * theme normalisation, theme resolution, export-mode pre-pass, font
 * resolution — and then, instead of calling PptxGenJS directly, it compiles to
 * PptxIR, checks the selected renderer can express it, and hands the IR to an
 * adapter.
 *
 * Not yet the default. It becomes the default when every component the legacy
 * path renders is lowered by the compiler and the parity fixtures pass through
 * it; until then `compilePresentation` reports anything it cannot lower and
 * this function refuses rather than shipping a deck with content missing.
 */

import { assertRendererSupports } from '@json-to-office/shared/rendering';
import { runWithBaseDir } from '../utils/baseDirContext';
import { compilePresentation } from '../ir/compiler';
import type { PptxIR } from '../ir/types';
import { resolvePptxRenderer } from '../renderers/registry';
import type {
  PipelineWarning,
  PresentationComponentDefinition,
  ProcessedPresentation,
} from '../types';
import { isPresentationComponent } from '../types';
import { resolveDocumentFonts } from './fontResolution';
import { resolveThemeContext } from './generationContext';
import {
  assertNoContentConflicts,
  assertValidPresentation,
  type GenerationOptions,
} from './generationOptions';
import { expandHighchartsComponents } from './expandHighcharts';
import { resolveImageLayout } from './resolveImageLayout';
import { processPresentation } from './structure';

/** Alias kept for readability at call sites inside the IR pipeline. */
export type IrGenerationOptions = GenerationOptions;

export interface IrGenerationResult {
  buffer: Buffer;
  warnings: PipelineWarning[];
}

/**
 * Thrown when the compiler meets a component it does not lower yet.
 *
 * Silently dropping the component would be worse than failing: the deck would
 * look complete and not be. This disappears when the compiler covers every
 * component kind.
 */
export class UncompiledComponentError extends Error {
  public readonly code = 'UNCOMPILED_COMPONENT';
  public readonly components: ReadonlyArray<{ name: string; path: string }>;

  constructor(components: ReadonlyArray<{ name: string; path: string }>) {
    const names = [...new Set(components.map((c) => c.name))]
      .map((n) => `"${n}"`)
      .join(', ');
    super(
      `The PptxIR compiler does not lower ${names} yet, so the IR path would ` +
        `drop ${components.length} component(s):\n` +
        components.map((c) => `  - ${c.name} at ${c.path}`).join('\n')
    );
    this.name = 'UncompiledComponentError';
    this.components = [...components];
  }
}

/**
 * Compile a presentation document to PptxIR without rendering it.
 *
 * Runs the same pre-passes as generation, so what comes back is the IR that
 * would be rendered — not a near-miss that omits image fitting.
 */
export async function compileDocumentToIr(
  jsonConfig: string | PresentationComponentDefinition,
  options?: IrGenerationOptions
): Promise<{
  ir: PptxIR;
  warnings: PipelineWarning[];
  required: ReturnType<typeof compilePresentation>['required'];
  unsupported: ReturnType<typeof compilePresentation>['unsupported'];
}> {
  assertValidPresentation(jsonConfig, options?.validation);
  const component = parseDocument(jsonConfig);
  const warnings: PipelineWarning[] = [];

  const context = resolveThemeContext(component, {
    customThemes: options?.customThemes,
    fonts: options?.fonts,
    warnings,
  });

  assertNoContentConflicts(context.document);

  const result = await runWithBaseDir(options?.baseDir, async () => {
    const processed = processPresentation(context.document, {
      ...options,
      theme: context.theme,
    });
    const expansion = await expandHighchartsComponents(
      processed,
      options?.services?.highcharts,
      warnings
    );
    const laidOut = await resolveImageLayout(expansion.presentation, warnings);
    const compiled = compilePresentation(laidOut, warnings);
    return {
      ...compiled,
      unsupported: [...compiled.unsupported, ...expansion.unexpanded],
    };
  });

  return {
    ir: result.ir,
    warnings: result.warnings,
    required: result.required,
    unsupported: result.unsupported,
  };
}

/** Generate a `.pptx` buffer through PptxIR and the selected renderer. */
export async function generateBufferViaIr(
  jsonConfig: string | PresentationComponentDefinition,
  options?: IrGenerationOptions
): Promise<IrGenerationResult> {
  assertValidPresentation(jsonConfig, options?.validation);
  const component = parseDocument(jsonConfig);
  const warnings: PipelineWarning[] = [];

  const context = resolveThemeContext(component, {
    customThemes: options?.customThemes,
    fonts: options?.fonts,
    warnings,
  });

  assertNoContentConflicts(context.document);

  // Fires `fonts.onResolved` for the preview stager, exactly as the legacy
  // path does. The PPTX itself never embeds font bytes.
  await resolveDocumentFonts(
    context.document,
    context.theme,
    warnings,
    options?.fonts
  );

  // Relative asset paths are resolved during compilation, so the base-directory
  // scope has to span it (#142).
  const buffer = await runWithBaseDir(options?.baseDir, () =>
    renderProcessedViaIr(
      processPresentation(context.document, {
        ...options,
        theme: context.theme,
      }),
      warnings,
      options
    )
  );

  return { buffer, warnings };
}

/**
 * Compile a processed presentation and render it with the selected backend.
 *
 * Shared by both entry points — the core buffer API and the plugin generator —
 * so the two cannot drift in which expansions run, which capabilities are
 * checked, or how the package is finalised.
 *
 * The caller is responsible for the base-directory scope: relative asset paths
 * are resolved during compilation (#142).
 */
export async function renderProcessedViaIr(
  processed: ProcessedPresentation,
  warnings: PipelineWarning[],
  options?: IrRenderOptions
): Promise<Buffer> {
  // `highcharts` fetches a PNG from an export server; resolving it before
  // compilation keeps the IR free of any service dependency.
  const expansion = await expandHighchartsComponents(
    processed,
    options?.services?.highcharts,
    warnings
  );
  // Fitting an image needs its intrinsic size, which needs I/O; resolving it
  // here keeps the compiler synchronous and free of file access.
  const laidOut = await resolveImageLayout(expansion.presentation, warnings);
  const compiled = compilePresentation(laidOut, warnings);

  const missing = [...compiled.unsupported, ...expansion.unexpanded];
  if (missing.length > 0) {
    throw new UncompiledComponentError(missing);
  }

  const renderer = await resolvePptxRenderer(options?.renderer);
  assertRendererSupports(compiled.required, renderer);

  const bytes = await renderer.render(compiled.ir, {
    ...(options?.deterministic !== undefined
      ? { deterministic: options.deterministic }
      : {}),
    ...(options?.generatedAt !== undefined
      ? { generatedAt: toDate(options.generatedAt) }
      : {}),
    // Post-render repairs report into the same list as the rest of the
    // pipeline, so a caller sees one set of warnings.
    warnings,
  });

  return Buffer.from(bytes);
}

/** The subset of options `renderProcessedViaIr` reads. */
export type IrRenderOptions = Pick<
  GenerationOptions,
  'renderer' | 'services' | 'deterministic' | 'generatedAt'
>;

function parseDocument(
  jsonConfig: string | PresentationComponentDefinition
): PresentationComponentDefinition {
  if (typeof jsonConfig !== 'string') return jsonConfig;
  const parsed = JSON.parse(jsonConfig);
  if (!isPresentationComponent(parsed)) {
    throw new Error('Parsed JSON must be a presentation component');
  }
  return parsed;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}
