/**
 * The IR-based DOCX generation path.
 *
 * Normalisation, theme resolution, font resolution, desugaring of the
 * service-backed components, structure and layout — and then, instead of
 * building renderer objects directly, it compiles to DocxIR, checks the
 * selected backend can express what the document needs, and hands the IR to an
 * adapter.
 *
 * The shape is deliberate: everything asynchronous or fallible happens before
 * compilation, so compiling is a pure function of the document plus the
 * resources already in hand. Two compilations of the same document give the
 * same IR, which is what makes the IR comparable, cacheable and snapshottable.
 */

import { assertRendererSupports } from '@json-to-office/shared/rendering';
import type { GenerationWarning, ServicesConfig } from '@json-to-office/shared';
import type { FontRuntimeOpts } from '@json-to-office/shared';
import { resolveDocumentFonts } from './fontResolution';
import { toRasterizeFontFaces } from '@json-to-office/shared/fonts/node';
import { collectVisualProps } from './prerasterizeVisuals';
import { normalizeDocument } from '../json/normalizer';
import { desugarExternals } from './desugarExternals';
import { loadImageResources } from './imageResources';
import { compileDocument, type UnsupportedComponent } from '../ir/compiler';
import type { DocxIR } from '../ir/types';
import { createDocxJsRenderer } from '../renderers/docxjs/index';
import type { DocxRendererId } from '../renderers/types';
import type { ThemeConfig } from '../styles';
import type { ReportComponentDefinition } from '../types';
import { resolveGenerationDate } from '../utils/packageDocument';
import {
  resolveThemeContext,
  type GenerationThemeContext,
} from './generationContext';
import { runWithBaseDir, runWithWarnings } from '../utils/generationContext';
import { applyLayout } from './layout';
import { processDocument } from './structure';

export interface IrDocxGenerationOptions {
  customThemes?: Record<string, ThemeConfig>;
  services?: ServicesConfig;
  fonts?: FontRuntimeOpts;
  warnings?: GenerationWarning[];
  baseDir?: string;
  deterministic?: boolean;
  generatedAt?: string | Date;
  /** Backend to render with. Defaults to `docxjs`. */
  renderer?: DocxRendererId;
  /**
   * A prologue already run by the caller.
   *
   * The plugin path has to resolve the theme before it expands custom
   * components — a component's `render` is handed the resolved theme — and
   * normalises the tree that expansion produced. Passing that result in means
   * the prologue runs once rather than twice, which matters because the
   * export-mode pre-pass inside it rewrites the document.
   */
  context?: GenerationThemeContext;
}

export interface IrDocxGenerationResult {
  buffer: Buffer;
  warnings: GenerationWarning[];
}

/**
 * Thrown when the compiler meets something it does not lower yet.
 *
 * Silently dropping it would be worse than failing: the document would look
 * complete and not be. This disappears as the compiler covers the surface.
 */
export class UncompiledComponentError extends Error {
  public readonly code = 'UNCOMPILED_COMPONENT';
  public readonly components: readonly UnsupportedComponent[];

  constructor(components: readonly UnsupportedComponent[]) {
    const names = [...new Set(components.map((c) => c.name))]
      .map((n) => `"${n}"`)
      .join(', ');
    super(
      `The DocxIR compiler does not lower ${names} yet, so the IR path would ` +
        `drop ${components.length} item(s):\n` +
        components
          .map(
            (c) =>
              `  - ${c.name} at ${c.path}${c.detail ? ` (${c.detail})` : ''}`
          )
          .join('\n')
    );
    this.name = 'UncompiledComponentError';
    this.components = [...components];
  }
}

export interface CompiledDocx {
  ir: DocxIR;
  theme: ThemeConfig;
  warnings: GenerationWarning[];
  required: ReturnType<typeof compileDocument>['required'];
  unsupported: UnsupportedComponent[];
}

/**
 * Compile a report definition to DocxIR without rendering it.
 *
 * Scoped rather than plain: a relative image path resolves against the
 * document's own directory, and leaf utilities report warnings into the
 * caller's collector, both through async-local state that has to be entered
 * before the walk begins.
 */
export async function compileDocumentToIr(
  document: ReportComponentDefinition,
  options: IrDocxGenerationOptions = {},
  collector?: GenerationWarning[]
): Promise<CompiledDocx> {
  const warnings = collector ?? options.warnings ?? [];
  return runWithWarnings(warnings, () =>
    runWithBaseDir(options.baseDir, () =>
      compileDocumentScoped(document, options, warnings)
    )
  );
}

async function compileDocumentScoped(
  document: ReportComponentDefinition,
  options: IrDocxGenerationOptions,
  warnings: GenerationWarning[]
): Promise<CompiledDocx> {
  // Authoring shorthand — string children, bare props, nested containers — is
  // expanded before anything reads the tree, exactly as every other caller
  // does. Skipping it would make the IR path see a different document from the
  // one the rest of the pipeline sees.
  const context =
    options.context ??
    resolveThemeContext(normalizeDocument(document)[0], {
      customThemes: options.customThemes,
      fonts: options.fonts,
      warnings,
    });

  // Fonts resolve for the LibreOffice preview stager's side-channel:
  // `resolveDocumentFonts` fires `fonts.onResolved` when a listener is
  // registered. The package never embeds the bytes.
  //
  // A `visual` is rasterized by an out-of-process LibreOffice that needs the
  // real font files, so a visual-bearing document forces materialisation even
  // with no listener. Gated on that check so a fontless-by-design build still
  // pays no network cost.
  const hasVisual = collectVisualProps(context.document).length > 0;
  const resolvedFonts = await resolveDocumentFonts(
    context.document,
    context.theme,
    options.fonts,
    warnings,
    hasVisual
  );
  // Gated on the ENCODED faces, not on how many fonts resolved: a safe-only
  // font resolves to an entry with no sources, which encodes to nothing, and a
  // document with only safe fonts must send no `fonts` key at all so its
  // rasterize request — and so its cache key — is unchanged.
  const visualFonts = hasVisual
    ? toRasterizeFontFaces(resolvedFonts, warnings)
    : [];

  // Charts and visuals become images before anything else reads the tree: they
  // are the only components that need a service, and past this point nothing
  // does.
  const desugared = await desugarExternals(context.document, {
    theme: context.theme,
    ...(options.services ? { services: options.services } : {}),
    ...(options.baseDir !== undefined ? { baseDir: options.baseDir } : {}),
    ...(visualFonts.length > 0 ? { visualFonts } : {}),
  });

  // One date for the whole build: the metadata Word shows, the `{DATE}` a
  // paragraph resolves and the timestamps the package is pinned to all have to
  // agree, or a document says it was made at two different moments.
  const structure = await processDocument(
    desugared,
    context.theme,
    context.themeName,
    resolveGenerationDate(options)
  );
  const layout = applyLayout(
    structure.sections,
    context.theme,
    context.themeName
  );
  // Image bytes are fetched up front so compilation itself stays synchronous
  // and pure: same document, same map, same IR.
  const images = await loadImageResources(
    layout.sections.flatMap((section) => [
      ...section.components,
      ...(Array.isArray(section.header) ? section.header : []),
      ...(Array.isArray(section.footer) ? section.footer : []),
    ])
  );
  const compiled = compileDocument(structure, layout, warnings, images, {
    // A caller that collects nothing still needs to hear about a dropped
    // value, so warnings go to the console when there is no collector.
    echoWarnings: options.warnings === undefined,
  });

  return {
    ir: compiled.ir,
    theme: context.theme,
    warnings: compiled.warnings,
    required: compiled.required,
    unsupported: compiled.unsupported,
  };
}

/** Generate a `.docx` buffer through DocxIR and the selected renderer. */
export async function generateBufferViaIr(
  document: ReportComponentDefinition,
  options: IrDocxGenerationOptions = {}
): Promise<IrDocxGenerationResult> {
  const warnings = options.warnings ?? [];
  // The same scope covers rendering, not only compiling: an adapter reports
  // through the same leaf helpers, and a warning raised while packaging bytes
  // belongs to the caller that asked for them.
  //
  // `options` is passed through unchanged, so the compiler can still tell
  // whether the caller supplied a collector — a caller that did not still
  // needs to hear about a dropped value, on the console.
  return runWithWarnings(warnings, () =>
    runWithBaseDir(options.baseDir, () =>
      renderScoped(document, options, warnings)
    )
  );
}

async function renderScoped(
  document: ReportComponentDefinition,
  options: IrDocxGenerationOptions,
  warnings: GenerationWarning[]
): Promise<IrDocxGenerationResult> {
  const compiled = await compileDocumentToIr(document, options, warnings);

  if (compiled.unsupported.length > 0) {
    throw new UncompiledComponentError(compiled.unsupported);
  }

  if (options.renderer && options.renderer !== 'docxjs') {
    throw new Error(
      `The "${options.renderer}" DOCX renderer is not implemented yet. ` +
        'Use the default "docxjs" renderer.'
    );
  }

  const renderer = createDocxJsRenderer({ theme: compiled.theme });
  assertRendererSupports(compiled.required, renderer);

  const bytes = await renderer.render(compiled.ir, {
    ...(options.deterministic !== undefined
      ? { deterministic: options.deterministic }
      : {}),
    ...(options.generatedAt !== undefined
      ? { generatedAt: toDate(options.generatedAt) }
      : {}),
    warnings: compiled.warnings,
  });

  return { buffer: Buffer.from(bytes), warnings: compiled.warnings };
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}
