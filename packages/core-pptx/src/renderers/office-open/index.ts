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
import {
  finalizePackage,
  readPackage,
  writePackage,
  resolveGeneratedAt,
} from '../../core/finalizePackage';
import { spliceChartParts } from './chartParts';
import { ALL_PPTX_FEATURES, type PptxFeature } from '../../ir/features';
import type {
  PptxIR,
  PptxIrChartElement,
  PptxIrResource,
} from '../../ir/types';
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
 * - `image-transform` — `PictureOptions` carries neither `rotation` nor a flip,
 *   so any transform on a picture would be silently discarded.
 * - `image-crop`, `image-rounding` — `PictureOptions` is `{data, type}` plus a
 *   frame and effects: no source rectangle, no geometry. A cropped picture
 *   would be drawn whole into the frame and a circular one would come out
 *   rectangular, neither with anything to show for it.
 * - `flip-vertical` — no pptx option type carries it, on any element.
 * - `element-hyperlinks` — `NonVisualDrawingPropertiesOptions` is
 *   `{name, description, title, hidden}`: a shape or picture cannot carry a
 *   link. Only runs can, which is why `text-hyperlinks` *is* declared and is
 *   realised by putting the link on the runs inside the body.
 * - `masters`, `placeholders` — layout and master generation are supported by
 *   the backend but not yet mapped here, and an unmapped master would lose
 *   every template object.
 * - `table-merged-cells` — the backend marks merges as `restart`/`continue` on
 *   the covered cells while the IR carries span counts; the translation is
 *   real work and is not yet proven by a test.
 * - `table-rounded-corners` — OOXML tables have no corner radius. The default
 *   backend fakes one with shapes drawn behind the table; that technique is
 *   not in the IR and is not reproduced here.
 * - `table-auto-page` — nothing in this backend flows a table onto a second
 *   slide, so an over-long table would run off the bottom of the first.
 * - `table-insets` — `TableCellOptions.margins` writes the insets onto the
 *   cell's own `a:bodyPr`, and a reader takes a cell's padding from
 *   `a:tcPr/@marL`: rendering the same table with a 0pt and a 40pt margin puts
 *   the text in exactly the same place.
 * - `image-fills` on a shape are supported and declared; the resource bytes are
 *   fetched before rendering.
 *
 * Table border and fill *are* declared: the backend has no table-level form of
 * either, but both are cell properties there and the adapter pushes them onto
 * every cell — see `tableChild` in `emit.ts`.
 *
 * The ten `chart-*` capabilities are the styling half of `charts`, and none is
 * declared yet: this adapter draws a chart from its data and honours its
 * title, legend, palette, axis titles and bar direction, but reads none of the
 * options that style it. Each moves into the declared set as its XML mapping
 * lands. Until then a deck that authored one is refused naming the prop, which
 * is the point — an ignored `valAxisMaxVal` used to draw a different chart
 * from the authored one with nothing in the file to say so.
 *
 * `charts` *is* declared, and used to not be. The backend writes chart XML
 * whose `<c:f>` references are empty and which has no workbook behind them, so
 * "Edit Data" failed and a chart you cannot edit is not the chart that was
 * asked for. Rather than refuse, the adapter now writes the missing half
 * itself — see `chartParts.ts`.
 */
const UNSUPPORTED: ReadonlySet<PptxFeature> = new Set<PptxFeature>([
  'svg',
  'chart-text-style',
  'image-transform',
  'image-crop',
  'image-rounding',
  'flip-vertical',
  'element-hyperlinks',
  'masters',
  'placeholders',
  'table-merged-cells',
  'table-rounded-corners',
  'table-auto-page',
  'table-insets',
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
      const charts: PptxIrChartElement[] = [];
      const presentation = await buildPresentationOptions(ir, charts);
      const bytes = await backend.generatePresentation(presentation, {
        type: 'uint8array',
      });
      const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

      // One zip, opened once: the chart repairs and the generic finalization
      // both need it, and a round-trip between them would cost a full
      // re-compress for nothing. This mirrors the pptxgenjs path, which also
      // applies its backend repairs and then calls `finalizePackage` on the
      // same open zip.
      //
      // The splice has to happen even when finalization is skipped — a chart
      // without its workbook is a broken chart, not an undeterministic one —
      // and it has to happen *before* finalization, because
      // `canonicalizeChartIds` renumbers chart parts and rewrites the
      // `Microsoft_Excel_Worksheet{N}.xlsx` references through the same map.
      if (charts.length === 0 && options?.deterministic === false) return raw;

      const zip = await readPackage(Buffer.from(raw));
      await spliceChartParts(zip, charts);

      if (options?.deterministic === false) {
        return new Uint8Array(await writePackage(zip));
      }
      // Generic package finalization. The backend stamps core metadata and ZIP
      // entries with the wall clock, so the same deck rendered twice differs.
      // Pinning those is a property of an OOXML package rather than of this
      // backend, which is why the same pass runs over the default backend's
      // output too.
      await finalizePackage(zip, resolveGeneratedAt(options?.generatedAt));
      return new Uint8Array(await writePackage(zip));
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
  ir: PptxIR,
  charts: PptxIrChartElement[] = []
): Promise<Record<string, unknown>> {
  // Drawing ids restart at 2 on each slide — 1 is the slide's own group — so
  // they depend on position in the deck and nothing else.
  let nextDrawingId = 2;
  const ctx: OfficeOpenEmitContext = {
    resources: new Map(ir.resources.map((r) => [r.id, r])),
    resourceBytes: await loadResourceBytes(ir.resources),
    nextId: () => nextDrawingId++,
    charts,
  };

  const presentation: Record<string, unknown> = {
    size: { width: ir.size.widthEmu, height: ir.size.heightEmu },
    slides: ir.slides.map((slide) => {
      nextDrawingId = 2;
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
  // `company` is an *extended* property — `docProps/app.xml`, not `core.xml` —
  // which is why it is not a sibling of the three above (#262).
  if (ir.metadata.company) {
    presentation.appProperties = { company: ir.metadata.company };
  }

  const theme = themeOptions(ir);
  if (theme) {
    // A theme belongs to a master, and the backend generates a default master
    // when none is declared. Declaring one here is what gives the deck a
    // `theme1.xml` carrying the authored fonts and palette rather than
    // PowerPoint's Office defaults (#258).
    presentation.masters = [{ name: ir.theme.name || 'Default', theme }];
  }

  return presentation;
}

/**
 * The authored theme, as the backend's `ThemeOptions`.
 *
 * Only what survives IR theme resolution: the major/minor font faces, which
 * are set on the presentation rather than on any element, and the resolved
 * palette. Element colours are already literal hex by this point, so the
 * scheme is not what draws the deck — it is what PowerPoint offers when
 * someone edits it, and what newly inserted content picks up.
 */
function themeOptions(ir: PptxIR): Record<string, unknown> | undefined {
  const { headingFont, bodyFont, palette, name } = ir.theme;
  const colorScheme = colorSchemeOptions(palette);
  if (!headingFont && !bodyFont && !colorScheme) return undefined;

  return {
    ...(name ? { name } : {}),
    fontScheme: {
      ...(name ? { name } : {}),
      ...(headingFont
        ? { majorFont: { latin: { typeface: headingFont } } }
        : {}),
      ...(bodyFont ? { minorFont: { latin: { typeface: bodyFont } } } : {}),
    },
    ...(colorScheme ? { colorScheme } : {}),
  };
}

/**
 * OOXML scheme slot ← the IR palette's project-owned slot.
 *
 * `PptxIrTheme.palette` is keyed by the project's own vocabulary, so an adapter
 * that writes a real `<a:clrScheme>` has to know which of those names each
 * OOXML slot holds. The pairing is the one the authoring surface already
 * accepts as aliases — see `SEMANTIC_TO_THEME_KEY` in `utils/color.ts`, which
 * resolves `accent1`, `tx1` and friends against the same slots.
 *
 * A palette entry with no OOXML counterpart is left out rather than invented
 * into a spare accent.
 */
const SCHEME_SLOTS: ReadonlyArray<readonly [string, string]> = [
  ['dark1', 'text'],
  ['light1', 'background'],
  ['dark2', 'text2'],
  ['light2', 'background2'],
  ['accent1', 'primary'],
  ['accent2', 'secondary'],
  ['accent3', 'accent'],
  ['accent4', 'accent4'],
  ['accent5', 'accent5'],
  ['accent6', 'accent6'],
];

function colorSchemeOptions(
  palette: Readonly<Record<string, string>>
): Record<string, string> | undefined {
  const scheme: Record<string, string> = {};
  for (const [slot, key] of SCHEME_SLOTS) {
    const value = palette[key];
    if (value) scheme[slot] = value;
  }
  return Object.keys(scheme).length > 0 ? scheme : undefined;
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
