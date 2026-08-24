/**
 * The PptxGenJS renderer.
 *
 * This is the only place in `core-pptx` production code allowed to import
 * `pptxgenjs`. It consumes PptxIR and nothing else — no author JSON, no
 * `ProcessedPresentation`, no theme lookups.
 */

import PptxGenJS from 'pptxgenjs';
import type { PptxFeature } from '../../ir/features';
import type {
  PptxIR,
  PptxIrBackground,
  PptxIrMaster,
  PptxIrResource,
  PptxIrSlide,
} from '../../ir/types';
import { emuToInches } from '../../ir/units';
import type { PipelineWarning } from '../../types';
import type { PptxRenderOptions, PptxRenderer, PptxRendererId } from '../types';
import { emitElement, imageSourceOpts, type EmitContext } from './emit';
import type { PendingFillSink } from './fills';
import { packagePptxGenJsBuffer } from './packaging';

export const PPTXGENJS_RENDERER_ID: PptxRendererId = 'pptxgenjs';

/**
 * Everything the PptxGenJS backend can express.
 *
 * The exclusions are real gaps, not omissions:
 * - `image-fills` — no shape image-fill API
 * - `transitions` — no transition API (and none in the pre-IR pipeline either)
 * - `groups` — no grouping API; groups are flattened upstream or rejected
 * - `complex-bullet-glyphs` — the API accepts only a four-digit BMP code
 */
/**
 * Explicit allowlist with four verified gaps. A new `PptxFeature` stays
 * unsupported until this adapter deliberately adds and tests it.
 *
 * Every `chart-*` styling capability is declared: `emitChart` forwards all of
 * them to pptxgenjs — the data labels, the data border, the axis bounds,
 * visibility, grid lines and rotation, the bar, line, pie and radar options and
 * every label font — so declaring them costs no existing deck a render.
 */
const PPTXGENJS_CAPABILITIES: ReadonlySet<PptxFeature> = new Set([
  'masters',
  'placeholders',
  'rich-text',
  'text',
  'shapes',
  'images',
  'svg',
  'image-crop',
  'image-rounding',
  'tables',
  'table-merged-cells',
  'table-insets',
  'table-rounded-corners',
  'table-auto-page',
  'charts',
  'chart-bar-style',
  'chart-pie-style',
  'chart-line-style',
  'chart-radar-style',
  'chart-data-labels',
  'chart-data-border',
  'chart-axis-scale',
  'chart-axis-visibility',
  'chart-axis-style',
  'chart-text-style',
  'solid-fills',
  'gradient-fills',
  'pattern-fills',
  'lines',
  'shadows',
  'backgrounds',
  'speaker-notes',
  'hidden-slides',
  'external-links',
  'internal-links',
  'text-hyperlinks',
  'element-hyperlinks',
  'rotation',
  'image-transform',
  'flip-horizontal',
  'flip-vertical',
  'proofing-language',
  'rtl',
]);

export function createPptxGenJsRenderer(): PptxRenderer {
  return {
    id: PPTXGENJS_RENDERER_ID,
    format: 'pptx',
    capabilities: PPTXGENJS_CAPABILITIES,
    async render(ir: PptxIR, options?: PptxRenderOptions): Promise<Uint8Array> {
      const pendingFills: PendingFillSink = [];
      const pptx = buildPresentation(ir, pendingFills, options?.warnings);
      const raw = (await pptx.write({
        outputType: 'nodebuffer',
      })) as Buffer;
      const packaged = await packagePptxGenJsBuffer(raw, {
        pendingFills,
        deterministic: options?.deterministic,
        generatedAt: options?.generatedAt,
        warnings: options?.warnings,
      });
      return new Uint8Array(packaged);
    },
  };
}

/**
 * Build the PptxGenJS object graph for an IR document.
 *
 * Exported for tests: it is the interesting half of the adapter, and asserting
 * on the object graph is far cheaper than unzipping a package.
 */
export function buildPresentation(
  ir: PptxIR,
  pendingFills?: PendingFillSink,
  warnings?: PipelineWarning[]
): PptxGenJS {
  const pptx = new PptxGenJS();

  if (ir.metadata.title) pptx.title = ir.metadata.title;
  if (ir.metadata.author) pptx.author = ir.metadata.author;
  if (ir.metadata.subject) pptx.subject = ir.metadata.subject;
  if (ir.metadata.company) pptx.company = ir.metadata.company;

  pptx.defineLayout({
    name: 'CUSTOM',
    width: emuToInches(ir.size.widthEmu),
    height: emuToInches(ir.size.heightEmu),
  });
  pptx.layout = 'CUSTOM';

  if (ir.rtl) pptx.rtlMode = true;

  pptx.theme = {
    headFontFace: ir.theme.headingFont,
    bodyFontFace: ir.theme.bodyFont,
  };

  const resources = new Map<string, PptxIrResource>(
    ir.resources.map((resource) => [resource.id, resource])
  );
  const ctx: EmitContext = { pptx, resources, pendingFills, warnings };

  for (const master of ir.masters) {
    pptx.defineSlideMaster(masterProps(master, resources) as never);
  }

  for (const slide of ir.slides) {
    emitSlide(pptx, slide, ctx);
  }

  return pptx;
}

/**
 * Master properties PptxGenJS understands.
 *
 * A master's fixed decoration is *not* passed as `objects`: the pipeline draws
 * template objects onto each slide instead, which is what the IR records, and
 * doing both would double them.
 */
function masterProps(
  master: PptxIrMaster,
  resources: ReadonlyMap<string, PptxIrResource>
): Record<string, unknown> {
  const props: Record<string, unknown> = { title: master.name };

  const background = backgroundProps(master.background, resources);
  if (background) props.background = background;
  if (master.margin !== undefined) props.margin = master.margin;

  if (master.slideNumber) {
    const slideNumber: Record<string, unknown> = {
      x: emuToInches(master.slideNumber.transform.xEmu),
      y: emuToInches(master.slideNumber.transform.yEmu),
      w: emuToInches(master.slideNumber.transform.widthEmu),
      h: emuToInches(master.slideNumber.transform.heightEmu),
    };
    if (master.slideNumber.color) {
      slideNumber.color = master.slideNumber.color.hex;
    }
    if (master.slideNumber.fontSize !== undefined) {
      slideNumber.fontSize = master.slideNumber.fontSize;
    }
    props.slideNumber = slideNumber;
  }

  return props;
}

function backgroundProps(
  background: PptxIrBackground | undefined,
  resources: ReadonlyMap<string, PptxIrResource>
): Record<string, unknown> | undefined {
  if (!background) return undefined;
  if (background.kind === 'solid') return { color: background.color.hex };

  const resource = resources.get(background.resourceId);
  if (!resource) return undefined;
  return imageSourceOpts(resource);
}

function emitSlide(
  pptx: PptxGenJS,
  slideIr: PptxIrSlide,
  ctx: EmitContext
): void {
  const slide = slideIr.masterName
    ? pptx.addSlide({ masterName: slideIr.masterName })
    : pptx.addSlide();

  const background = backgroundProps(slideIr.background, ctx.resources);
  if (background) slide.background = background as never;

  if (slideIr.hidden) slide.hidden = true;

  for (const element of slideIr.elements) {
    emitElement(slide, element, ctx);
  }

  if (slideIr.notes) slide.addNotes(slideIr.notes);
}
