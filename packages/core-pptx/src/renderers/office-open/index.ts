/**
 * The experimental `@office-open/pptx` renderer.
 *
 * Selecting it is explicit and opt-in; `pptxgenjs` stays the default. The
 * backend is an optional peer dependency, resolved at call time so a missing
 * package surfaces as an install hint rather than a module-resolution failure.
 *
 * The capability set below is deliberately narrow. A feature is listed only
 * when it has been proven against the real package, never from its README, and
 * a gap in the backend is expressed by *omitting* the capability — which makes
 * the compiler reject the document before any bytes exist, instead of shipping
 * a deck with content quietly missing.
 */

import { readFile } from 'node:fs/promises';
import { ALL_PPTX_FEATURES, type PptxFeature } from '../../ir/features';
import type { PptxIR, PptxIrResource } from '../../ir/types';
import type { PptxRenderOptions, PptxRenderer, PptxRendererId } from '../types';
import { background, slideChild, type OfficeOpenEmitContext } from './emit';

export const OFFICE_OPEN_PPTX_RENDERER_ID: PptxRendererId = 'office-open';

/**
 * Module specifier held in a variable so TypeScript does not resolve the
 * optional dependency at build time and the failure lands at selection time.
 */
const OFFICE_OPEN_PPTX = '@office-open/pptx';

/**
 * What this adapter does *not* declare, and why. Each is a verified gap, not
 * an unfinished mapping:
 *
 * - `svg` — `PictureOptions.type` excludes SVG and no code path creates an SVG
 *   media entry, so an SVG would ship as a broken image.
 * - `charts` — chart XML is written without the embedded workbook, so the
 *   chart renders but "Edit Data" fails. A chart you cannot edit is not the
 *   chart that was asked for.
 * - `image-rotation` — `PictureOptions` has no `rotation`; the transform is
 *   silently discarded.
 * - `flip-vertical` — no pptx option type carries it.
 * - `masters`, `placeholders` — layout and master generation are supported by
 *   the backend but not yet mapped here, and an unmapped master would lose
 *   every template object.
 * - `table-merged-cells` — the backend marks merges as `restart`/`continue` on
 *   the covered cells while the IR carries span counts; the translation is
 *   real work and is not yet proven by a test.
 * - `image-fills` on a shape are supported and declared; the resource bytes are
 *   fetched before rendering.
 */
const UNSUPPORTED: ReadonlySet<PptxFeature> = new Set<PptxFeature>([
  'svg',
  'charts',
  'image-rotation',
  'flip-vertical',
  'masters',
  'placeholders',
  'table-merged-cells',
]);

const OFFICE_OPEN_CAPABILITIES: ReadonlySet<PptxFeature> = new Set(
  [...ALL_PPTX_FEATURES].filter((feature) => !UNSUPPORTED.has(feature))
);

interface OfficeOpenBackend {
  generatePresentation: (
    options: Record<string, unknown>,
    packerOptions?: { type?: string }
  ) => Promise<Uint8Array>;
}

export async function createOfficeOpenPptxRenderer(): Promise<PptxRenderer> {
  // Throws `Cannot find package '@office-open/pptx'` when the optional
  // dependency is absent; the registry rewrites that into an install hint.
  const backend = (await import(
    /* @vite-ignore */ OFFICE_OPEN_PPTX
  )) as unknown as OfficeOpenBackend;

  if (typeof backend.generatePresentation !== 'function') {
    throw new Error(
      `${OFFICE_OPEN_PPTX} does not export generatePresentation(); the installed version is not compatible with this adapter.`
    );
  }

  return {
    id: OFFICE_OPEN_PPTX_RENDERER_ID,
    format: 'pptx',
    capabilities: OFFICE_OPEN_CAPABILITIES,
    async render(ir: PptxIR, options?: PptxRenderOptions): Promise<Uint8Array> {
      const presentation = await buildPresentationOptions(ir);
      const bytes = await backend.generatePresentation(presentation, {
        type: 'uint8array',
      });
      void options;
      return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    },
  };
}

/**
 * Build the backend's document object for an IR presentation.
 *
 * Exported for tests: asserting on this object is far cheaper, and far more
 * legible, than unzipping a package.
 */
export async function buildPresentationOptions(
  ir: PptxIR
): Promise<Record<string, unknown>> {
  const ctx: OfficeOpenEmitContext = {
    resources: new Map(ir.resources.map((r) => [r.id, r])),
    resourceBytes: await loadResourceBytes(ir.resources),
  };

  const presentation: Record<string, unknown> = {
    size: { width: ir.size.widthEmu, height: ir.size.heightEmu },
    slides: ir.slides.map((slide) => {
      const out: Record<string, unknown> = {
        children: slide.elements.map((element) => slideChild(element, ctx)),
      };
      if (slide.background) {
        out.background = background(slide.background, ctx);
      }
      if (slide.notes) out.notes = slide.notes;
      if (slide.hidden) out.hidden = true;
      if (slide.transition) {
        out.transition = {
          type: slide.transition.type,
          ...(slide.transition.speed ? { speed: slide.transition.speed } : {}),
        };
      }
      return out;
    }),
  };

  if (ir.rtl) presentation.rtl = true;
  if (ir.metadata.title) presentation.title = ir.metadata.title;
  if (ir.metadata.author) presentation.creator = ir.metadata.author;
  if (ir.metadata.subject) presentation.subject = ir.metadata.subject;

  return presentation;
}

/**
 * Read the bytes for every resource.
 *
 * The backend embeds media by value, so file and remote resources — which the
 * IR deliberately keeps as locations, so a large deck is not held in memory by
 * the default path — are materialised here, in the adapter that needs them.
 */
async function loadResourceBytes(
  resources: readonly PptxIrResource[]
): Promise<Map<string, Uint8Array>> {
  const entries = await Promise.all(
    resources.map(async (resource) => {
      switch (resource.origin.kind) {
        case 'inline':
          return [resource.id, resource.origin.bytes] as const;
        case 'file':
          return [
            resource.id,
            new Uint8Array(await readFile(resource.origin.path)),
          ] as const;
        case 'remote': {
          const response = await fetch(resource.origin.url);
          if (!response.ok) {
            throw new Error(
              `failed to fetch image ${resource.origin.url}: ${response.status} ${response.statusText}`
            );
          }
          return [
            resource.id,
            new Uint8Array(await response.arrayBuffer()),
          ] as const;
        }
      }
    })
  );
  return new Map(entries);
}
