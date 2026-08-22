/**
 * The IR-based DOCX generation path.
 *
 * Same prologue as `generateBufferFromJson` — validation, normalisation, theme
 * resolution, the export-mode pre-pass, font resolution, structure and layout —
 * and then, instead of building docx.js objects directly, it compiles to
 * DocxIR, checks the selected renderer can express it, and hands the IR to an
 * adapter.
 *
 * Not the default, and not close to it: the compiler covers paragraphs,
 * headings, sections and headers/footers, and refuses everything else. It is
 * wired up so the slice can be measured against the pre-IR path case by case,
 * which is the only way the rest of the migration can be checked rather than
 * hoped for.
 */

import { assertRendererSupports } from '@json-to-office/shared/rendering';
import type { GenerationWarning, ServicesConfig } from '@json-to-office/shared';
import type { FontRuntimeOpts } from '@json-to-office/shared';
import { normalizeDocument } from '../json/normalizer';
import { compileDocument, type UnsupportedComponent } from '../ir/compiler';
import type { DocxIR } from '../ir/types';
import { createDocxJsRenderer } from '../renderers/docxjs/index';
import type { DocxRendererId } from '../renderers/types';
import type { ThemeConfig } from '../styles';
import type { ReportComponentDefinition } from '../types';
import { resolveThemeContext } from './generationContext';
import { applyLayout } from './layout';
import { processDocument } from './structure';

export interface IrDocxGenerationOptions {
  customThemes?: Record<string, ThemeConfig>;
  services?: ServicesConfig;
  fonts?: FontRuntimeOpts;
  warnings?: GenerationWarning[];
  generationDate?: Date;
  baseDir?: string;
  deterministic?: boolean;
  generatedAt?: string | Date;
  /** Backend to render with. Defaults to `docxjs`. */
  renderer?: DocxRendererId;
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

/** Compile a report definition to DocxIR without rendering it. */
export async function compileDocumentToIr(
  document: ReportComponentDefinition,
  options: IrDocxGenerationOptions = {}
): Promise<CompiledDocx> {
  const warnings = options.warnings ?? [];
  // Authoring shorthand — string children, bare props, nested containers — is
  // expanded before anything reads the tree, exactly as the JSON entry point
  // and the plugin pipeline both do. Skipping it would make the IR path see a
  // different document from the one every other caller sees.
  const [normalized] = normalizeDocument(document);
  const context = resolveThemeContext(normalized, {
    customThemes: options.customThemes,
    fonts: options.fonts,
    warnings,
  });

  const structure = await processDocument(
    context.document,
    context.theme,
    context.themeName,
    options.generationDate
  );
  const layout = applyLayout(
    structure.sections,
    context.theme,
    context.themeName
  );
  const compiled = compileDocument(structure, layout, warnings);

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
  const compiled = await compileDocumentToIr(document, options);

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
