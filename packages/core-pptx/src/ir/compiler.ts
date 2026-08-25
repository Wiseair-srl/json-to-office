/**
 * Compile a processed presentation into PptxIR.
 *
 * The input is `ProcessedPresentation` — the authoring tree after schema
 * validation, custom-component expansion, theme resolution and component
 * defaults. What remains, and what this module does, is the last mile of
 * resolution: grid cells become EMU transforms, placeholder content is merged
 * with its declaration, theme colour tokens become hex, the font cascade is
 * flattened onto every run, and page-number placeholders are substituted.
 *
 * No renderer is imported here, and none may be. The output is plain data.
 *
 * Scope: this is the Phase 2 vertical slice — metadata, slide size, slides,
 * solid backgrounds, text bodies (single and rich-run), images and preset
 * shapes. Component kinds outside that slice are reported through
 * `unsupported`, so a caller can tell "not yet compiled" from "compiled to
 * nothing".
 */

import {
  FeatureRequirementCollector,
  type FeatureRequirement,
} from '@json-to-office/shared/rendering';
import type { TextSegment } from '@json-to-office/shared-pptx';
import { PATTERN_FILL_PRESETS } from '@json-to-office/shared-pptx';
import type {
  GridConfig,
  PipelineWarning,
  PptxComponentInput,
  PptxThemeConfig,
  ProcessedPresentation,
  ProcessedSlide,
  SlideContext,
  StyleName,
  TemplateSlideDefinition,
} from '../types';
import { definedChartColorTokens, resolveColor } from '../utils/color';
import { applyFontWeight } from '../utils/fontAliasContext';
import { getDefaultsForType } from '../utils/componentDefaults';
import { resolveComponentDefaults } from '../utils/resolveComponentTree';
import { resolveImageSource, safeLocalPath } from '../utils/imageSource';
import {
  HYPERLINK_SLIDE_UNRESOLVED,
  type HyperlinkProps,
} from '../utils/hyperlink';
import { mergeGridConfigs, resolveComponentGridPosition } from '../core/grid';
import { mergeWithDefaults } from '@json-to-office/shared';
import { W, warn } from '../utils/warn';
import type { PptxFeature } from './features';
import {
  ResourceTable,
  mediaTypeFromLocation,
  parseDataUri,
} from './resources';
import {
  PPTX_IR_GEOMETRY,
  PPTX_IR_SCHEMA_VERSION,
  type PptxIR,
  type PptxIrBackground,
  type PptxIrBullet,
  type PptxIrColor,
  type PptxIrElement,
  type PptxIrFill,
  type PptxIrGeometry,
  type PptxIrGradient,
  type PptxIrHyperlink,
  type PptxIrImageSizing,
  type PptxIrKnownGeometry,
  type PptxIrLine,
  type PptxIrMaster,
  type PptxIrPlaceholder,
  type PptxIrRunFormatting,
  type PptxIrChartGridLine,
  type PptxIrChartLabelFont,
  type PptxIrChartOptions,
  type PptxIrChartType,
  type PptxIrShadow,
  type PptxIrTableBorder,
  type PptxIrTableCell,
  type PptxIrTableCellFormatting,
  type PptxIrTableElement,
  type PptxIrTableFormatting,
  type PptxIrTableRow,
  type PptxIrSlide,
  type PptxIrTextBodyStyle,
  type PptxIrTextRun,
  type PptxIrTransform,
  type PptxIrTransition,
} from './types';
import {
  defaultWidthEmu,
  elementId,
  inchesToEmu,
  irColor,
  normalizeDegrees,
  resolveDimensionEmu,
  type SlideExtentEmu,
} from './units';

/** A component kind the compiler does not yet lower into IR. */
export interface UnsupportedComponent {
  name: string;
  path: string;
}

export interface PptxCompileResult {
  ir: PptxIR;
  /** Backend capabilities the IR needs, with the IR path that needs them. */
  required: readonly FeatureRequirement<PptxFeature>[];
  warnings: PipelineWarning[];
  /**
   * Components the compiler could not lower. Empty once the migration is
   * complete; until then this is what keeps the legacy path authoritative
   * instead of silently dropping content.
   */
  unsupported: UnsupportedComponent[];
}

/** Shared mutable state for one compilation. Never module-global. */
interface CompileContext {
  theme: PptxThemeConfig;
  warnings: PipelineWarning[];
  features: FeatureRequirementCollector<PptxFeature>;
  resources: ResourceTable;
  unsupported: UnsupportedComponent[];
  slideWidthInches: number;
  slideHeightInches: number;
  /** Slide extent in EMU — what percentage dimensions resolve against. */
  extent: SlideExtentEmu;
  /**
   * Text boxes on the slide being compiled that stated no coordinates at all.
   *
   * Reset per slide by `compileSlide`. A named style now lands each role in a
   * band of its own, but two boxes sharing a style still share a band, and the
   * IR alone cannot tell a deliberate overlay from two elements nobody
   * positioned — so authored-ness is recorded here while it is still known.
   */
  positionlessText: Array<{ path: string; transform: PptxIrTransform }>;
}

export function compilePresentation(
  processed: ProcessedPresentation,
  warnings: PipelineWarning[] = []
): PptxCompileResult {
  const ctx: CompileContext = {
    theme: processed.theme,
    warnings,
    features: new FeatureRequirementCollector<PptxFeature>(),
    resources: new ResourceTable(),
    unsupported: [],
    slideWidthInches: processed.slideWidth,
    slideHeightInches: processed.slideHeight,
    extent: {
      widthEmu: inchesToEmu(processed.slideWidth),
      heightEmu: inchesToEmu(processed.slideHeight),
    },
    positionlessText: [],
  };

  const masters = (processed.templates ?? []).map((template, index) =>
    compileMaster(template, index, processed, ctx)
  );
  if (masters.length > 0) {
    ctx.features.require('masters', 'masters');
  }

  const slides = processed.slides.map((slide, index) =>
    compileSlide(slide, index, processed, ctx)
  );

  if (processed.rtlMode) ctx.features.require('rtl', 'rtl');

  const ir: PptxIR = {
    schemaVersion: PPTX_IR_SCHEMA_VERSION,
    metadata: { ...processed.metadata },
    size: { ...ctx.extent },
    theme: {
      name: processed.theme.name,
      headingFont: processed.theme.fonts.heading,
      bodyFont: processed.theme.fonts.body,
      palette: resolvePalette(processed.theme),
    },
    rtl: processed.rtlMode,
    ...(processed.language ? { language: processed.language } : {}),
    resources: ctx.resources.list(),
    masters,
    slides,
  };

  return {
    ir,
    required: ctx.features.list(),
    warnings: ctx.warnings,
    unsupported: ctx.unsupported,
  };
}

/* ------------------------------------------------------------------ *
 * Theme
 * ------------------------------------------------------------------ */

/**
 * Resolve every theme colour slot to hex.
 *
 * Slots may name other slots; `resolveColor` walks those chains. Resolution
 * runs without a warning sink because an unset optional slot is normal here —
 * it only matters when an element actually references it, and that call site
 * reports it.
 */
function resolvePalette(theme: PptxThemeConfig): Record<string, string> {
  const palette: Record<string, string> = {};
  for (const [slot, value] of Object.entries(theme.colors)) {
    if (typeof value !== 'string' || value.length === 0) continue;
    palette[slot] = resolveColor(value, theme).toUpperCase();
  }
  return palette;
}

/* ------------------------------------------------------------------ *
 * Masters
 * ------------------------------------------------------------------ */

function compileMaster(
  template: TemplateSlideDefinition,
  templateIndex: number,
  processed: ProcessedPresentation,
  ctx: CompileContext
): PptxIrMaster {
  const path = `masters[${templateIndex}]`;
  const background = compileBackground(
    template.background,
    `${path}.background`,
    ctx
  );

  // A template's fixed objects are drawn onto every slide that uses it, not
  // into the master part — that is what the pipeline has always done, and it
  // is what `compileSlide` records. Compiling them here as well would put the
  // same content in the IR twice. The field stays on the master for a backend
  // that supports genuine master-level decoration.
  const elements: PptxIrElement[] = [];

  const placeholders: PptxIrPlaceholder[] = (template.placeholders ?? []).map(
    (placeholder) => {
      const transform = optionalTransform(
        placeholder.x,
        placeholder.y,
        placeholder.w,
        placeholder.h,
        ctx
      );
      return transform
        ? { name: placeholder.name, transform }
        : { name: placeholder.name };
    }
  );
  if (placeholders.length > 0) {
    ctx.features.require('placeholders', `${path}.placeholders`);
  }

  const master: PptxIrMaster = {
    name: template.name,
    ...(background ? { background } : {}),
    ...(template.margin !== undefined ? { margin: template.margin } : {}),
    elements,
    placeholders,
  };

  if (template.slideNumber) {
    const sn = template.slideNumber;
    master.slideNumber = {
      transform: {
        xEmu: inchesToEmu(sn.x),
        yEmu: inchesToEmu(sn.y),
        widthEmu: inchesToEmu(sn.w ?? 1),
        heightEmu: inchesToEmu(sn.h ?? 0.3),
      },
      ...(sn.color
        ? { color: irColor(resolveColor(sn.color, ctx.theme, ctx.warnings)) }
        : {}),
      ...(sn.fontSize !== undefined ? { fontSize: sn.fontSize } : {}),
    };
  }

  // A template gradient background is not a background: it compiles to a
  // full-bleed shape at the back of every slide that uses the template. The
  // slide compiler emits it, because that is where slide element order lives.
  void processed;

  return master;
}

/* ------------------------------------------------------------------ *
 * Slides
 * ------------------------------------------------------------------ */

function compileSlide(
  slide: ProcessedSlide,
  slideIndex: number,
  processed: ProcessedPresentation,
  ctx: CompileContext
): PptxIrSlide {
  const path = `slides[${slideIndex}]`;
  const templates = new Map(
    (processed.templates ?? []).map((template) => [template.name, template])
  );
  const template = slide.template ? templates.get(slide.template) : undefined;
  if (slide.template && !template) {
    warn(
      ctx.warnings,
      W.MISSING_TEMPLATE,
      `Unknown template "${slide.template}". Available: ${[...templates.keys()].join(', ')}`,
      { slide: slideIndex }
    );
  }

  const elements: PptxIrElement[] = [];
  let nextIndex = 0;
  const push = (element: PptxIrElement | undefined) => {
    if (element) elements.push(element);
    nextIndex += 1;
  };

  // Per slide: two boxes only collide with each other if they share one.
  ctx.positionlessText = [];

  // A gradient background renders as a full-bleed rectangle added first, so it
  // sits behind everything else. The slide's own background wins over the
  // template's, matching the pre-IR pipeline.
  const gradientSource =
    slide.background?.gradient ??
    (slide.background ? undefined : template?.background?.gradient);
  let background: PptxIrBackground | undefined;
  if (gradientSource) {
    const gradient = compileGradient(
      gradientSource,
      `${path}.background.gradient`,
      ctx
    );
    if (gradient) {
      ctx.features.require('gradient-fills', `${path}.background`);
      elements.push({
        kind: 'shape',
        id: elementId(slideIndex, [nextIndex]),
        path: `${path}.elements[${nextIndex}]`,
        transform: {
          xEmu: 0,
          yEmu: 0,
          widthEmu: inchesToEmu(ctx.slideWidthInches),
          heightEmu: inchesToEmu(ctx.slideHeightInches),
        },
        geometry: 'rect',
        fill: { kind: 'gradient', gradient },
      });
      ctx.features.require('shapes', `${path}.elements[${nextIndex}]`);
      nextIndex += 1;
    }
  } else {
    background = compileBackground(slide.background, `${path}.background`, ctx);
  }

  const effectiveGrid = mergeGridConfigs(processed.grid, template?.grid);

  // Template fixed objects draw beneath slide content.
  // Template objects are drawn onto this slide, so they see this slide's
  // context: a `{PAGE_NUMBER}` in a template header has to resolve, and its
  // runs inherit the deck language like any other.
  for (const object of template?.objects ?? []) {
    push(
      compileComponent(object, {
        ctx,
        path: `${path}.elements[${nextIndex}]`,
        id: elementId(slideIndex, [nextIndex]),
        slideCtx: slideContextFor(slideIndex, processed),
      })
    );
  }

  for (const component of slide.components) {
    const resolved = resolveComponentGridPosition(
      component,
      effectiveGrid,
      ctx.slideWidthInches,
      ctx.slideHeightInches,
      ctx.warnings
    );
    push(
      compileComponent(resolved, {
        ctx,
        path: `${path}.elements[${nextIndex}]`,
        id: elementId(slideIndex, [nextIndex]),
        slideCtx: slideContextFor(slideIndex, processed),
      })
    );
  }

  for (const component of compilePlaceholderComponents(
    slide,
    template,
    effectiveGrid,
    slideIndex,
    ctx
  )) {
    push(
      compileComponent(component, {
        ctx,
        path: `${path}.elements[${nextIndex}]`,
        id: elementId(slideIndex, [nextIndex]),
        slideCtx: slideContextFor(slideIndex, processed),
      })
    );
  }

  warnOverlappingText(slideIndex, ctx);

  if (slide.notes) ctx.features.require('speaker-notes', `${path}.notes`);
  if (slide.hidden) ctx.features.require('hidden-slides', `${path}.hidden`);
  if (background) ctx.features.require('backgrounds', `${path}.background`);

  const transition = compileTransition(slide.transition);
  if (transition) ctx.features.require('transitions', `${path}.transition`);

  return {
    id: `slide${slideIndex + 1}`,
    path,
    ...(slide.template ? { masterName: slide.template } : {}),
    ...(background ? { background } : {}),
    elements,
    ...(slide.notes ? { notes: slide.notes } : {}),
    hidden: slide.hidden === true,
    ...(transition ? { transition } : {}),
  };
}

/**
 * Report text boxes nobody positioned that landed on top of each other.
 *
 * Only boxes that stated neither `x` nor `y` are compared: an overlap between
 * two authored positions is a composition, and one between an authored box and
 * a default is at least half deliberate. Two defaults on the same slide are
 * nobody's decision — before the style bands that was every pair, and it is
 * still every pair that shares a style.
 *
 * A warning rather than a repair. Moving one of the two would be a layout
 * engine's job (#220), and guessing which one should move is exactly the
 * guess that produces a deck the author did not write.
 */
function warnOverlappingText(slideIndex: number, ctx: CompileContext): void {
  const boxes = ctx.positionlessText;
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i];
      const b = boxes[j];
      const overlaps =
        a.transform.xEmu < b.transform.xEmu + b.transform.widthEmu &&
        b.transform.xEmu < a.transform.xEmu + a.transform.widthEmu &&
        a.transform.yEmu < b.transform.yEmu + b.transform.heightEmu &&
        b.transform.yEmu < a.transform.yEmu + a.transform.heightEmu;
      if (!overlaps) continue;
      warn(
        ctx.warnings,
        W.TEXT_OVERLAP_UNPOSITIONED,
        `Text at ${a.path} and ${b.path} give no x/y and overlap on this slide. ` +
          'Give at least one of them explicit coordinates, or a named style ' +
          'whose default band differs.',
        { slide: slideIndex, component: 'text' }
      );
    }
  }
}

/**
 * An authored transition.
 *
 * `none` is an authored transition too — it says "do not inherit one" — but
 * OOXML expresses that by omitting `<p:transition>`, so it lowers to nothing
 * and asks nothing of the backend.
 */
function compileTransition(
  transition: ProcessedSlide['transition']
): PptxIrTransition | undefined {
  const type = transition?.type;
  if (!type || type === 'none') return undefined;
  return {
    type,
    ...(transition?.speed
      ? { speed: transition.speed as PptxIrTransition['speed'] }
      : {}),
  };
}

function slideContextFor(
  slideIndex: number,
  processed: ProcessedPresentation
): SlideContext {
  return {
    slideNumber: slideIndex + 1,
    totalSlides: processed.slides.length,
    pageNumberFormat: processed.pageNumberFormat,
    language: processed.language,
  };
}

/**
 * Merge slide-side placeholder content with its master declaration.
 *
 * Precedence matches the pre-IR renderer: componentDefaults < declared
 * position < declared defaults < the component's own props.
 */
function compilePlaceholderComponents(
  slide: ProcessedSlide,
  template: TemplateSlideDefinition | undefined,
  effectiveGrid: GridConfig | undefined,
  slideIndex: number,
  ctx: CompileContext
): PptxComponentInput[] {
  if (!slide.placeholders) return [];
  const out: PptxComponentInput[] = [];

  if (!template) {
    // No template: a placeholder is only renderable if it positions itself.
    for (const [name, component] of Object.entries(slide.placeholders)) {
      const defaulted = resolveComponentDefaults(component, ctx.theme);
      const positioned =
        defaulted.props.x != null ||
        defaulted.props.y != null ||
        defaulted.props.grid;
      if (!positioned) {
        warn(
          ctx.warnings,
          W.PLACEHOLDER_NO_POSITION,
          `Placeholder "${name}" has no template and no explicit position — skipped`,
          { slide: slideIndex }
        );
        continue;
      }
      out.push(
        resolveComponentGridPosition(
          defaulted,
          effectiveGrid,
          ctx.slideWidthInches,
          ctx.slideHeightInches,
          ctx.warnings
        )
      );
    }
    return out;
  }

  const declared = new Map(
    (template.placeholders ?? []).map((placeholder) => [
      placeholder.name,
      placeholder,
    ])
  );

  for (const [name, component] of Object.entries(slide.placeholders)) {
    const definition = declared.get(name);
    if (!definition) {
      warn(
        ctx.warnings,
        W.UNKNOWN_PLACEHOLDER,
        `Unknown placeholder "${name}" in template "${slide.template}". Available: ${[...declared.keys()].join(', ')}`,
        { slide: slideIndex }
      );
      continue;
    }

    const gridResolved = resolveComponentGridPosition(
      component,
      effectiveGrid,
      ctx.slideWidthInches,
      ctx.slideHeightInches,
      ctx.warnings
    );

    const typeDefaults = getDefaultsForType(component.name, ctx.theme);
    const positionDefaults: Record<string, unknown> = {};
    if (definition.x != null) positionDefaults.x = definition.x;
    if (definition.y != null) positionDefaults.y = definition.y;
    if (definition.w != null) positionDefaults.w = definition.w;
    if (definition.h != null) positionDefaults.h = definition.h;

    let props = mergeWithDefaults(positionDefaults, typeDefaults);
    props = mergeWithDefaults(definition.defaults?.props ?? {}, props);
    props = mergeWithDefaults(gridResolved.props, props);

    out.push({ ...gridResolved, props });
  }

  return out;
}

/* ------------------------------------------------------------------ *
 * Components
 * ------------------------------------------------------------------ */

interface ComponentScope {
  ctx: CompileContext;
  path: string;
  id: string;
  slideCtx?: SlideContext;
}

function compileComponent(
  component: PptxComponentInput,
  scope: ComponentScope
): PptxIrElement | undefined {
  if (component.enabled === false) return undefined;

  switch (component.name) {
    case 'text':
      return compileText(component, scope);
    case 'shape':
      return compileShape(component, scope);
    case 'image':
      return compileImage(component, scope);
    case 'table':
      return compileTable(component, scope);
    case 'chart':
      return compileChart(component, scope);
    case 'highcharts':
      // Modelled in the IR, not yet lowered. Recorded rather than dropped.
      scope.ctx.unsupported.push({ name: component.name, path: scope.path });
      return undefined;
    default:
      warn(
        scope.ctx.warnings,
        W.UNKNOWN_COMPONENT,
        `Unknown PPTX component type: ${component.name}`,
        { component: component.name }
      );
      return undefined;
  }
}

/* ------------------------------------------------------------------ *
 * Text
 * ------------------------------------------------------------------ */

interface TextRunProps {
  text: string;
  color?: string;
  bold?: boolean;
  fontWeight?: number;
  italic?: boolean;
  underline?: boolean | { style?: string; color?: string };
  strike?: boolean;
  fontSize?: number;
  fontFace?: string;
  superscript?: boolean;
  subscript?: boolean;
  charSpacing?: number;
  breakLine?: boolean;
}

function compileText(
  component: PptxComponentInput,
  scope: ComponentScope
): PptxIrElement | undefined {
  const { ctx, path } = scope;
  const props = component.props as Record<string, any>;
  const runProps: TextRunProps[] | undefined =
    Array.isArray(props.runs) && props.runs.length > 0 ? props.runs : undefined;

  if (props.text === undefined && !runProps) {
    warn(
      ctx.warnings,
      W.TEXT_NO_CONTENT,
      'Text component has neither "text" nor "runs" — skipped',
      { component: 'text' }
    );
    return undefined;
  }

  const named = namedStyle(props.style, ctx.theme);
  // Component override wins over the deck default; with neither set the
  // renderer falls back to its own default, so nothing is recorded.
  const cascade = fontCascade(
    props,
    named,
    ctx,
    (props.language as string | undefined) ?? scope.slideCtx?.language
  );

  const lineCount = runProps
    ? runProps.reduce(
        (count, run) =>
          count +
          (run.breakLine ? 1 : 0) +
          (run.text.match(/\n/g)?.length ?? 0),
        1
      )
    : ((props.text as string).match(/\n/g)?.length ?? 0) + 1;

  // The derived height has always been sized from the component's own font
  // size or the theme default — not from the named style's size. Using
  // `cascade.fontSize` here would silently resize every styled text box that
  // omits an explicit height.
  const heightFontSize =
    (props.fontSize as number | undefined) ?? ctx.theme.defaults.fontSize ?? 18;
  const transform = textTransform(props, heightFontSize, lineCount, ctx);
  const autoFit = props.h === undefined;

  // Recorded before the transform leaves this function: downstream, a band
  // default and an authored coordinate are the same two numbers.
  if (props.x === undefined && props.y === undefined) {
    ctx.positionlessText.push({ path, transform });
  }

  const hyperlink = compileHyperlink(props.hyperlink, 'text', ctx, path);
  // The link belongs to the text box, not to each run: attaching it per run
  // emits one identical external relationship per run.
  const runs: PptxIrTextRun[] = runProps
    ? runProps.map((run) =>
        compileRichRun(run, cascade, undefined, scope.slideCtx, ctx)
      )
    : [
        {
          text: substitutePageNumbers(props.text as string, scope.slideCtx),
          ...baseRunFormatting(cascade),
          ...(cascade.strike != null ? { strike: cascade.strike } : {}),
          ...(cascade.underline ? { underline: cascade.underline } : {}),
          ...(cascade.language ? { language: cascade.language } : {}),
          ...(props.breakLine ? { breakAfter: true } : {}),
        },
      ];

  ctx.features.require('text', path);
  if (runs.length > 1) ctx.features.require('rich-text', path);
  if (cascade.language) ctx.features.require('proofing-language', path);
  if (hyperlink) ctx.features.require('text-hyperlinks', path);

  const fill = props.fill
    ? compileSolidFillFromProps(props.fill, `${path}.fill`, ctx)
    : undefined;
  if (fill) ctx.features.require('solid-fills', `${path}.fill`);

  const shadow = compileShadow(props.shadow, ctx);
  if (shadow) ctx.features.require('shadows', `${path}.shadow`);

  const bodyStyle = textBodyStyle(props, named, cascade, {
    autoFit,
    // Text boxes have always defaulted their inset to 0 so the text lines up
    // exactly with the position the author (or the grid) gave it.
    defaultInsetPoints: 0,
  });
  requireBulletFeatures(bodyStyle.bullet, path, ctx);

  return {
    kind: 'textBox',
    id: scope.id,
    path,
    transform,
    runs,
    style: bodyStyle,
    ...(fill ? { fill } : {}),
    ...(shadow ? { shadow } : {}),
    ...(hyperlink ? { hyperlink } : {}),
  };
}

interface FontCascade {
  fontFamily: string;
  /** The family before weight aliasing, used to resolve per-run aliases. */
  baseFamily: string;
  fontSize: number;
  color: PptxIrColor;
  bold?: boolean;
  italic?: boolean;
  fontWeight?: number;
  characterSpacing?: number;
  underline?: PptxIrTextRun['underline'];
  strike?: boolean;
  language?: string;
}

function namedStyle(
  style: unknown,
  theme: PptxThemeConfig
): { style?: ReturnType<typeof pickStyle>; isHeading: boolean } {
  const name = typeof style === 'string' ? (style as StyleName) : undefined;
  return {
    style: name ? pickStyle(theme, name) : undefined,
    isHeading: name !== undefined && /^(title|heading)/.test(name),
  };
}

function pickStyle(theme: PptxThemeConfig, name: StyleName) {
  return theme.styles?.[name];
}

/**
 * Flatten component props → named style → theme defaults into one set of run
 * formatting values, applying weight aliasing exactly once.
 */
function fontCascade(
  props: Record<string, any>,
  named: ReturnType<typeof namedStyle>,
  ctx: CompileContext,
  /**
   * Proofing language for the runs. Text bodies inherit the deck default when
   * they do not name one; shapes never carry a language, so they pass nothing.
   */
  language?: string
): FontCascade {
  const style = named.style;
  const fontSize =
    props.fontSize ?? style?.fontSize ?? ctx.theme.defaults.fontSize;
  const baseFamily =
    props.fontFace ??
    style?.fontFace ??
    (named.isHeading ? ctx.theme.fonts.heading : ctx.theme.fonts.body);
  const color = irColor(
    resolveColor(
      props.color ??
        props.fontColor ??
        style?.fontColor ??
        ctx.theme.defaults.fontColor,
      ctx.theme,
      ctx.warnings
    )
  );

  const bold = props.bold ?? style?.bold;
  const italic = props.italic ?? style?.italic;
  const fontWeight = props.fontWeight ?? style?.fontWeight;
  const characterSpacing = props.charSpacing ?? style?.charSpacing;

  let fontFamily = baseFamily;
  let effectiveBold = bold;
  let effectiveItalic = italic;
  if (fontWeight != null || bold === true) {
    const aliased = applyFontWeight({
      family: baseFamily,
      fontWeight,
      italic,
      bold,
    });
    if (aliased.fontFace !== undefined) fontFamily = aliased.fontFace;
    if (aliased.bold !== undefined) effectiveBold = aliased.bold;
    if (aliased.italic !== undefined) effectiveItalic = aliased.italic;
  }

  return {
    fontFamily,
    baseFamily,
    fontSize,
    color,
    ...(effectiveBold != null ? { bold: effectiveBold } : {}),
    ...(effectiveItalic != null ? { italic: effectiveItalic } : {}),
    ...(fontWeight != null ? { fontWeight } : {}),
    ...(characterSpacing != null ? { characterSpacing } : {}),
    ...(props.underline !== undefined
      ? { underline: compileUnderline(props.underline, ctx) }
      : {}),
    ...(props.strike != null ? { strike: props.strike as boolean } : {}),
    ...(language ? { language } : {}),
  };
}

function baseRunFormatting(
  cascade: FontCascade
): Pick<
  PptxIrTextRun,
  'fontFamily' | 'fontSize' | 'color' | 'bold' | 'italic' | 'characterSpacing'
> {
  return {
    fontFamily: cascade.fontFamily,
    fontSize: cascade.fontSize,
    color: cascade.color,
    ...(cascade.bold != null ? { bold: cascade.bold } : {}),
    ...(cascade.italic != null ? { italic: cascade.italic } : {}),
    ...(cascade.characterSpacing != null
      ? { characterSpacing: cascade.characterSpacing }
      : {}),
  };
}

function compileRichRun(
  run: TextRunProps,
  cascade: FontCascade,
  hyperlink: PptxIrHyperlink | undefined,
  slideCtx: SlideContext | undefined,
  ctx: CompileContext
): PptxIrTextRun {
  const effectiveWeight = run.fontWeight ?? cascade.fontWeight;
  const effectiveBold = run.bold ?? cascade.bold;
  const effectiveItalic = run.italic ?? cascade.italic;

  let fontFamily = run.fontFace ?? cascade.fontFamily;
  let bold = effectiveBold;
  let italic = effectiveItalic;

  // Only alias when the run inherits the component family. A run that names
  // its own face has already chosen it; re-aliasing would double the suffix.
  if (
    run.fontFace == null &&
    (effectiveWeight != null || effectiveBold === true)
  ) {
    const aliased = applyFontWeight({
      family: cascade.baseFamily,
      fontWeight: effectiveWeight,
      italic: effectiveItalic,
      bold: effectiveBold,
    });
    if (aliased.fontFace !== undefined) fontFamily = aliased.fontFace;
    if (aliased.bold !== undefined) bold = aliased.bold;
    if (aliased.italic !== undefined) italic = aliased.italic;
  }

  // Component-level underline and strike cascade into every run, exactly as
  // size, family and colour do. Reading only the run's own value silently drops
  // formatting the author set once for the whole body.
  const underline =
    run.underline !== undefined
      ? compileUnderline(run.underline, ctx)
      : cascade.underline;
  const strike = run.strike ?? cascade.strike;

  return {
    text: substitutePageNumbers(run.text, slideCtx),
    fontFamily,
    fontSize: run.fontSize ?? cascade.fontSize,
    color:
      run.color != null
        ? irColor(resolveColor(run.color, ctx.theme, ctx.warnings))
        : cascade.color,
    ...(bold != null ? { bold } : {}),
    ...(italic != null ? { italic } : {}),
    ...(strike != null ? { strike } : {}),
    ...(underline ? { underline } : {}),
    ...(run.superscript != null ? { superscript: run.superscript } : {}),
    ...(run.subscript != null ? { subscript: run.subscript } : {}),
    ...(run.charSpacing != null
      ? { characterSpacing: run.charSpacing }
      : cascade.characterSpacing != null
        ? { characterSpacing: cascade.characterSpacing }
        : {}),
    ...(cascade.language ? { language: cascade.language } : {}),
    ...(run.breakLine != null ? { breakAfter: run.breakLine } : {}),
    ...(hyperlink ? { hyperlink } : {}),
  };
}

function compileUnderline(
  underline: boolean | { style?: string; color?: string },
  ctx: CompileContext
): PptxIrTextRun['underline'] {
  if (typeof underline === 'boolean') {
    return underline ? { style: 'sng' } : undefined;
  }
  return {
    style: underline.style ?? 'sng',
    ...(underline.color
      ? {
          color: irColor(
            resolveColor(underline.color, ctx.theme, ctx.warnings)
          ),
        }
      : {}),
  };
}

function substitutePageNumbers(
  text: string,
  slideCtx: SlideContext | undefined
): string {
  if (!slideCtx) return text;
  const { slideNumber, totalSlides, pageNumberFormat } = slideCtx;
  const format = (n: number) =>
    pageNumberFormat === '09'
      ? String(n).padStart(String(totalSlides).length, '0')
      : String(n);
  return text
    .replace(/\{PAGE_NUMBER\}/g, format(slideNumber))
    .replace(/\{PAGE_COUNT\}/g, format(totalSlides));
}

interface TextBodyStyleOptions {
  autoFit?: boolean;
  /**
   * Inset to state when the component does not set `margin`. A text box
   * defaults to 0 so it aligns exactly to its position; a shape states
   * nothing and keeps the format's own padding.
   */
  defaultInsetPoints?: number;
}

function textBodyStyle(
  props: Record<string, any>,
  named: ReturnType<typeof namedStyle>,
  cascade: FontCascade,
  options: TextBodyStyleOptions = {}
): PptxIrTextBodyStyle {
  const style = named.style;
  const align = props.align ?? style?.align;
  const lineSpacing = props.lineSpacing ?? style?.lineSpacing;
  const spaceAfter = props.paraSpaceAfter ?? style?.paraSpaceAfter;
  const inset = props.margin ?? options.defaultInsetPoints;

  return {
    ...(align ? { align: align as PptxIrTextBodyStyle['align'] } : {}),
    verticalAlign: (props.valign ??
      'top') as PptxIrTextBodyStyle['verticalAlign'],
    ...(props.lineSpacingMultiple !== undefined
      ? { lineSpacingMultiple: props.lineSpacingMultiple }
      : lineSpacing !== undefined
        ? { lineSpacingPoints: lineSpacing }
        : {}),
    ...(props.paraSpaceBefore !== undefined
      ? { spaceBeforePoints: props.paraSpaceBefore }
      : {}),
    ...(spaceAfter !== undefined ? { spaceAfterPoints: spaceAfter } : {}),
    ...(props.bullet !== undefined
      ? { bullet: compileBullet(props.bullet) }
      : {}),
    ...(inset !== undefined
      ? { insetPoints: inset as PptxIrTextBodyStyle['insetPoints'] }
      : {}),
    ...(options.autoFit ? { autoFit: true } : {}),
    defaults: bodyDefaults(cascade),
  };
}

/** The body-level formatting an empty paragraph inherits. */
function bodyDefaults(cascade: FontCascade): PptxIrRunFormatting {
  return {
    fontFamily: cascade.fontFamily,
    fontSize: cascade.fontSize,
    color: cascade.color,
    ...(cascade.bold != null ? { bold: cascade.bold } : {}),
    ...(cascade.italic != null ? { italic: cascade.italic } : {}),
    ...(cascade.language ? { language: cascade.language } : {}),
  };
}

/**
 * An authored bullet value, as the IR states it.
 *
 * `false` is a statement, not an absence: it has to reach the backend as an
 * explicit "no bullet", because the paragraph may be inheriting one from a
 * named style or from the format's own list style. Compiling it to an enabled
 * bullet is what #254 was.
 */
function compileBullet(
  bullet: boolean | { type?: string; style?: string; startAt?: number }
): PptxIrBullet {
  if (typeof bullet === 'boolean') {
    return { type: bullet ? 'bullet' : 'none' };
  }
  return {
    type: bullet.type === 'number' ? 'number' : 'bullet',
    ...(bullet.style ? { style: bullet.style } : {}),
    ...(bullet.startAt !== undefined ? { startAt: bullet.startAt } : {}),
  };
}

/** Record glyphs the default backend cannot represent without substitution. */
function requireBulletFeatures(
  bullet: PptxIrBullet | undefined,
  path: string,
  ctx: CompileContext
): void {
  if (bullet?.type !== 'bullet' || bullet.style === undefined) return;
  const points = [...bullet.style];
  const codePoint = points[0]?.codePointAt(0);
  if (points.length !== 1 || codePoint === undefined || codePoint > 0xffff) {
    ctx.features.require('complex-bullet-glyphs', `${path}.bullet.style`);
  }
}

/**
 * Where each named style sits when the author gives no coordinates.
 *
 * Fractions of the slide extent, so a band means the same thing on 16:9, 4:3
 * and any custom size. Without these every positionless text box resolved to
 * (0, 0): a title and a subtitle on one slide stacked on top of each other in
 * the top-left corner, which is the shape the starters had — so the documents
 * meant to be copied were the ones that demonstrated the defect.
 *
 * A style names a role, and a role has a place on the slide. `body` and
 * `caption` still collide with a second box of the same style, which no fixed
 * band can solve; `warnOverlappingText` reports that case rather than letting
 * it render silently.
 */
const STYLE_BANDS: Readonly<
  Record<string, { x: number; y: number; w: number }>
> = {
  // A title slide's title and its subtitle, as two bands in the middle third.
  title: { x: 0.08, y: 0.34, w: 0.84 },
  subtitle: { x: 0.08, y: 0.56, w: 0.84 },
  // Content-slide headings sit in the top margin, all three at the same place:
  // the level changes the type, not where the slide starts.
  heading1: { x: 0.06, y: 0.06, w: 0.88 },
  heading2: { x: 0.06, y: 0.06, w: 0.88 },
  heading3: { x: 0.06, y: 0.06, w: 0.88 },
  // Below a heading, in the content-safe area.
  body: { x: 0.06, y: 0.26, w: 0.88 },
  caption: { x: 0.06, y: 0.88, w: 0.88 },
};

/**
 * Position a text box, reproducing the pre-IR default height.
 *
 * When no height is authored, the renderer used to derive one from the font
 * size and line count so LibreOffice — which draws `cy="0"` as blank — still
 * showed the text. That derivation is layout, so it belongs here.
 *
 * Each axis is decided on its own: an author who states `x` and not `y` has
 * taken control of one of them, and the band is still the better answer for
 * the other than the origin.
 */
function textTransform(
  props: Record<string, any>,
  fontSize: number,
  lineCount: number,
  ctx: CompileContext
): PptxIrTransform {
  // With no authored height, derive one from the font size and line count —
  // LibreOffice draws `cy="0"` as blank, so the pipeline has always supplied a
  // height here rather than letting it default to zero.
  const heightEmu =
    props.h !== undefined
      ? resolveDimensionEmu(props.h, 'Y', ctx.extent)
      : inchesToEmu(Math.max(0.5, (fontSize / 72) * 1.6 * lineCount));

  // Only a named style carries a band. An unstyled text box keeps the origin
  // it has always had: nothing here knows what role it plays, and inventing
  // one would move every such box in every existing deck.
  const band =
    typeof props.style === 'string' ? STYLE_BANDS[props.style] : undefined;

  return {
    xEmu:
      props.x !== undefined
        ? resolveDimensionEmu(props.x, 'X', ctx.extent)
        : Math.round((band?.x ?? 0) * ctx.extent.widthEmu),
    yEmu:
      props.y !== undefined
        ? resolveDimensionEmu(props.y, 'Y', ctx.extent)
        : Math.round((band?.y ?? 0) * ctx.extent.heightEmu),
    widthEmu:
      props.w !== undefined
        ? resolveDimensionEmu(props.w, 'X', ctx.extent)
        : band
          ? Math.round(band.w * ctx.extent.widthEmu)
          : defaultWidthEmu(ctx.extent),
    heightEmu,
    ...rotationProperty(props.rotate),
  };
}

/* ------------------------------------------------------------------ *
 * Shapes
 * ------------------------------------------------------------------ */

const GEOMETRY_ALIASES: Record<string, PptxIrKnownGeometry> = {
  arrow: 'rightArrow',
  lightning: 'lightningBolt',
};

function compileShape(
  component: PptxComponentInput,
  scope: ComponentScope
): PptxIrElement | undefined {
  const { ctx, path } = scope;
  const props = component.props as Record<string, any>;

  // A geometry outside the known preset set is carried as `{ custom }` rather
  // than rejected: the backends do not agree on which presets exist, so only
  // an adapter can tell an arc from a typo.
  const geometry = compileGeometry(props.type);
  const named = namedStyle(props.style, ctx.theme);

  const fill = compileFill(props.fill, `${path}.fill`, ctx);
  if (fill) requireFillFeature(fill, `${path}.fill`, ctx);

  const line = compileLine(props.line, ctx);
  if (line) ctx.features.require('lines', `${path}.line`);

  const shadow = compileShadow(props.shadow, ctx);
  if (shadow) ctx.features.require('shadows', `${path}.shadow`);

  const hasText =
    props.text !== undefined &&
    (!Array.isArray(props.text) || props.text.length > 0);

  let runs: PptxIrTextRun[] | undefined;
  let style: PptxIrTextBodyStyle | undefined;
  if (hasText) {
    const cascade = fontCascade(props, named, ctx);
    runs = Array.isArray(props.text)
      ? (props.text as TextSegment[]).map((segment) =>
          compileTextSegment(segment, cascade, ctx)
        )
      : [{ text: props.text as string, ...baseRunFormatting(cascade) }];
    style = textBodyStyle(props, named, cascade);
    requireBulletFeatures(style.bullet, path, ctx);
    ctx.features.require('text', path);
    if (runs.length > 1) ctx.features.require('rich-text', path);
  }

  const hyperlink = compileHyperlink(props.hyperlink, 'shape', ctx, path);

  ctx.features.require('shapes', path);
  if (hyperlink) ctx.features.require('element-hyperlinks', path);
  const transform = shapeTransform(props, ctx);
  requireTransformFeatures(transform, path, 'shape', ctx);

  return {
    kind: 'shape',
    id: scope.id,
    path,
    transform,
    geometry,
    ...(fill ? { fill } : {}),
    ...(line ? { line } : {}),
    ...(shadow ? { shadow } : {}),
    ...(props.rectRadius !== undefined
      ? { cornerRadius: props.rectRadius as number }
      : {}),
    ...(props.angleRange !== undefined
      ? { angleRangeDegrees: props.angleRange as [number, number] }
      : {}),
    ...(runs ? { runs } : {}),
    ...(style ? { style } : {}),
    ...(hyperlink ? { hyperlink } : {}),
  };
}

function compileGeometry(type: unknown): PptxIrGeometry {
  const name = typeof type === 'string' ? type : '';
  const aliased = GEOMETRY_ALIASES[name] ?? name;
  return (PPTX_IR_GEOMETRY as readonly string[]).includes(aliased)
    ? (aliased as PptxIrKnownGeometry)
    : { custom: name };
}

function compileTextSegment(
  segment: TextSegment,
  cascade: FontCascade,
  ctx: CompileContext
): PptxIrTextRun {
  const segmentWeight = (segment as TextSegment & { fontWeight?: number })
    .fontWeight;
  const effectiveWeight = segmentWeight ?? cascade.fontWeight;
  const effectiveBold = segment.bold ?? cascade.bold;
  const effectiveItalic = segment.italic ?? cascade.italic;

  let fontFamily = segment.fontFace ?? cascade.fontFamily;
  let bold = effectiveBold;
  let italic = effectiveItalic;

  if (
    segment.fontFace == null &&
    (effectiveWeight != null || effectiveBold === true)
  ) {
    const aliased = applyFontWeight({
      family: cascade.baseFamily,
      fontWeight: effectiveWeight,
      italic: effectiveItalic,
      bold: effectiveBold,
    });
    if (aliased.fontFace !== undefined) fontFamily = aliased.fontFace;
    if (aliased.bold !== undefined) bold = aliased.bold;
    if (aliased.italic !== undefined) italic = aliased.italic;
  }

  return {
    text: segment.text,
    fontFamily,
    fontSize: segment.fontSize ?? cascade.fontSize,
    color:
      segment.color != null
        ? irColor(resolveColor(segment.color, ctx.theme, ctx.warnings))
        : cascade.color,
    ...(bold != null ? { bold } : {}),
    ...(italic != null ? { italic } : {}),
    ...(segment.charSpacing != null
      ? { characterSpacing: segment.charSpacing }
      : cascade.characterSpacing != null
        ? { characterSpacing: cascade.characterSpacing }
        : {}),
    ...(segment.breakLine != null ? { breakAfter: segment.breakLine } : {}),
    ...(segment.spaceBefore != null
      ? { spaceBeforePoints: segment.spaceBefore }
      : {}),
    ...(segment.spaceAfter != null
      ? { spaceAfterPoints: segment.spaceAfter }
      : {}),
  };
}

/**
 * Position any absolutely-placed element.
 *
 * Unstated x, y and h are zero; unstated width falls back to
 * `defaultWidthEmu`, which is the width such an element has always been given.
 */
function shapeTransform(
  props: Record<string, any>,
  ctx: CompileContext,
  options: { markAuto?: boolean } = {}
): PptxIrTransform {
  const autoWidth = options.markAuto && props.w === undefined;
  const autoHeight = options.markAuto && props.h === undefined;
  return {
    ...(autoWidth ? { autoWidth: true } : {}),
    ...(autoHeight ? { autoHeight: true } : {}),
    xEmu:
      props.x !== undefined ? resolveDimensionEmu(props.x, 'X', ctx.extent) : 0,
    yEmu:
      props.y !== undefined ? resolveDimensionEmu(props.y, 'Y', ctx.extent) : 0,
    widthEmu:
      props.w !== undefined
        ? resolveDimensionEmu(props.w, 'X', ctx.extent)
        : defaultWidthEmu(ctx.extent),
    heightEmu:
      props.h !== undefined ? resolveDimensionEmu(props.h, 'Y', ctx.extent) : 0,
    ...rotationProperty(props.rotate),
    ...(props.flipH ? { flipHorizontal: true } : {}),
    ...(props.flipV ? { flipVertical: true } : {}),
  };
}

/** Omit full-turn rotations: they are identity, not a backend requirement. */
function rotationProperty(
  value: unknown
): Pick<PptxIrTransform, 'rotationDegrees'> {
  if (typeof value !== 'number' || value % 360 === 0) return {};
  return { rotationDegrees: value };
}

/**
 * Record the transform abilities an element actually uses.
 *
 * Rotation is split by element kind because backends differ: one may rotate a
 * shape but not a picture. Flips are separate for the same reason.
 */
function requireTransformFeatures(
  transform: PptxIrTransform,
  path: string,
  kind: 'shape' | 'image',
  ctx: CompileContext
): void {
  const transformed =
    transform.rotationDegrees !== undefined ||
    transform.flipHorizontal === true ||
    transform.flipVertical === true;
  if (!transformed) return;

  if (kind === 'image') {
    // A picture type that carries no rotation generally carries no flip
    // either, so one requirement covers both.
    ctx.features.require('image-transform', path);
    return;
  }

  if (transform.rotationDegrees !== undefined) {
    ctx.features.require('rotation', path);
  }
  if (transform.flipHorizontal) ctx.features.require('flip-horizontal', path);
  if (transform.flipVertical) ctx.features.require('flip-vertical', path);
}

/* ------------------------------------------------------------------ *
 * Images
 * ------------------------------------------------------------------ */

function compileImage(
  component: PptxComponentInput,
  scope: ComponentScope
): PptxIrElement | undefined {
  const { ctx, path } = scope;
  const props = component.props as Record<string, any>;

  const source = resolveImageSource(props);
  if (!source) {
    warn(
      ctx.warnings,
      W.IMAGE_NO_SOURCE,
      'Image component missing path, base64, and svg',
      { component: 'image' }
    );
    return undefined;
  }

  const resourceId = internImageSource(source, path, ctx);
  if (resourceId === undefined) return undefined;

  const resource = ctx.resources.get(resourceId);
  ctx.features.require('images', path);
  if (resource?.mediaType === 'image/svg+xml') {
    ctx.features.require('svg', path);
  }

  const shadow = compileShadow(props.shadow, ctx);
  if (shadow) ctx.features.require('shadows', `${path}.shadow`);

  const hyperlink = compileHyperlink(props.hyperlink, 'image', ctx, path);
  if (hyperlink) ctx.features.require('element-hyperlinks', path);

  // An image with a sizing box and no stated extent takes its size from that
  // box; materialising a default width here would override it.
  const transform = shapeTransform(props, ctx, { markAuto: true });
  requireTransformFeatures(transform, path, 'image', ctx);

  const sizing = compileImageSizing(props.sizing, ctx);
  if (sizing) ctx.features.require('image-crop', `${path}.sizing`);
  if (props.rounding)
    ctx.features.require('image-rounding', `${path}.rounding`);

  return {
    kind: 'image',
    id: scope.id,
    path,
    transform,
    resourceId,
    ...(sizing ? { sizing } : {}),
    ...(props.rounding ? { rounding: true } : {}),
    ...(shadow ? { shadow } : {}),
    ...(hyperlink ? { hyperlink } : {}),
    ...(props.alt ? { altText: props.alt as string } : {}),
  };
}

/**
 * Turn a resolved image source string into a resource id.
 *
 * Data URIs are decoded to bytes here so identical inline images collapse to a
 * single resource. File paths keep the same allowed-root policy the pre-IR
 * pipeline enforced, and are rejected — with a warning, not silently — when
 * they escape it.
 */
function internImageSource(
  source: string,
  path: string,
  ctx: CompileContext
): string | undefined {
  const inline = parseDataUri(source);
  if (inline) {
    return ctx.resources.intern({
      kind: 'inline',
      bytes: inline.bytes,
      mediaType: inline.mediaType,
    });
  }

  if (/^https?:\/\//.test(source)) {
    return ctx.resources.intern({
      kind: 'remote',
      url: source,
      ...(mediaTypeFromLocation(source)
        ? { mediaType: mediaTypeFromLocation(source) }
        : {}),
    });
  }

  const resolved = safeLocalPath(source);
  if (resolved === undefined) {
    warn(
      ctx.warnings,
      W.IMAGE_PATH_OUTSIDE_ROOTS,
      `Image path resolves outside the document base directory: ${source}`,
      { component: 'image' }
    );
    return undefined;
  }
  void path;
  return ctx.resources.intern({
    kind: 'file',
    path: resolved,
    ...(mediaTypeFromLocation(resolved)
      ? { mediaType: mediaTypeFromLocation(resolved) }
      : {}),
  });
}

/**
 * Carry an image's sizing through to the IR.
 *
 * `contain` never reaches here: `resolveImageLayout` fits and centres the
 * element itself and drops the sizing, because the box has already been
 * honoured by the transform.
 */
function compileImageSizing(
  sizing:
    | {
        type?: string;
        w?: number | string;
        h?: number | string;
        x?: number | string;
        y?: number | string;
      }
    | undefined,
  ctx: CompileContext
): PptxIrImageSizing | undefined {
  if (!sizing?.type) return undefined;
  const type =
    sizing.type === 'cover'
      ? 'cover'
      : sizing.type === 'contain'
        ? 'contain'
        : 'crop';
  return {
    type,
    widthEmu: resolveDimensionEmu(sizing.w ?? 0, 'X', ctx.extent),
    heightEmu: resolveDimensionEmu(sizing.h ?? 0, 'Y', ctx.extent),
    ...(sizing.x !== undefined
      ? { xEmu: resolveDimensionEmu(sizing.x, 'X', ctx.extent) }
      : {}),
    ...(sizing.y !== undefined
      ? { yEmu: resolveDimensionEmu(sizing.y, 'Y', ctx.extent) }
      : {}),
  };
}

/* ------------------------------------------------------------------ *
 * Tables
 * ------------------------------------------------------------------ */

/**
 * Characters PowerPoint may promote to colour emoji.
 *
 * Appending VS15 (U+FE0E) forces text presentation. This is a property of how
 * the *format* is rendered, not of any one backend, so it belongs here rather
 * than in an adapter.
 */
const EMOJI_PRONE_CHARS = /[✓✔✗✘☐☑☒★☆●○■□▶◀▲▼⚡⚠❌❓❗]/gu;

function forceTextPresentation(text: string): string {
  return text.replace(EMOJI_PRONE_CHARS, (char) => `${char}\uFE0E`);
}

interface AuthoredTableCell {
  text: string;
  color?: string;
  fill?: string;
  fontSize?: number;
  fontFace?: string;
  bold?: boolean;
  fontWeight?: number;
  italic?: boolean;
  align?: string;
  valign?: string;
  colspan?: number;
  rowspan?: number;
  margin?: number | number[];
}

function compileTable(
  component: PptxComponentInput,
  scope: ComponentScope
): PptxIrElement | undefined {
  const { ctx, path } = scope;
  const props = component.props as Record<string, any>;
  const authoredRows = (props.rows ?? []) as Array<
    Array<string | AuthoredTableCell>
  >;

  const defaults = compileTableDefaults(props, ctx);
  const rows: PptxIrTableRow[] = authoredRows.map((row) => ({
    cells: row.map((cell) => compileTableCell(cell, props, ctx)),
  }));

  // A header row is a compile-time treatment of row 0, not a new thing for a
  // backend to understand: both renderers already draw per-cell fill and
  // weight, so nothing about this reaches the IR that was not there before.
  if (props.headerRow && rows.length > 0) {
    rows[0] = {
      cells: rows[0].cells.map((cell) => headerCell(cell, props, ctx)),
    };
  }

  const border = compileTableBorder(props.border, ctx);
  const cornerRadius =
    typeof props.borderRadius === 'number' && props.borderRadius > 0
      ? props.borderRadius
      : undefined;

  ctx.features.require('tables', path);
  if (
    rows.some((row) =>
      row.cells.some((cell) => cell.colSpan != null || cell.rowSpan != null)
    )
  ) {
    ctx.features.require('table-merged-cells', path);
  }
  if (cornerRadius !== undefined) {
    ctx.features.require('table-rounded-corners', `${path}.borderRadius`);
  }
  if (props.autoPage) {
    ctx.features.require('table-auto-page', `${path}.autoPage`);
  }
  if (props.autoPageRepeatHeader) {
    ctx.features.require('table-auto-page', `${path}.autoPageRepeatHeader`);
  }
  if (defaults.insetPoints !== undefined) {
    ctx.features.require('table-insets', `${path}.margin`);
  }
  rows.forEach((row, rowIndex) =>
    row.cells.forEach((cell, cellIndex) => {
      if (cell.formatting?.insetPoints !== undefined) {
        ctx.features.require(
          'table-insets',
          `${path}.rows[${rowIndex}][${cellIndex}].margin`
        );
      }
    })
  );

  const element: PptxIrTableElement = {
    kind: 'table',
    id: scope.id,
    path,
    transform: tableTransform(props, ctx),
    rows,
    columnWidthsEmu: toEmuList(props.colW, 'X', ctx),
    rowHeightsEmu: toEmuList(props.rowH, 'Y', ctx),
    defaults,
    ...(border ? { border } : {}),
    ...(props.fill
      ? { fill: irColor(resolveColor(props.fill, ctx.theme, ctx.warnings)) }
      : {}),
    ...(cornerRadius !== undefined ? { cornerRadiusInches: cornerRadius } : {}),
    ...(props.autoPage ? { autoPage: true } : {}),
    ...(props.autoPageRepeatHeader ? { autoPageRepeatHeader: true } : {}),
  };
  return element;
}

/**
 * Table geometry.
 *
 * Width and height are marked auto when the author states neither, because an
 * OOXML table sizes from its columns and rows. Position resolves through the
 * same rule every other element uses — the pre-IR pipeline applied a different
 * inch/EMU threshold to tables than to shapes, which is a backend detail, not
 * an authoring rule (see docs/architecture/office-renderer-ir.md).
 */
function tableTransform(
  props: Record<string, any>,
  ctx: CompileContext
): PptxIrTransform {
  const hasWidth = props.w !== undefined;
  const hasHeight = props.h !== undefined;
  return {
    xEmu:
      props.x !== undefined ? resolveDimensionEmu(props.x, 'X', ctx.extent) : 0,
    yEmu:
      props.y !== undefined ? resolveDimensionEmu(props.y, 'Y', ctx.extent) : 0,
    widthEmu: hasWidth
      ? resolveDimensionEmu(props.w, 'X', ctx.extent)
      : defaultWidthEmu(ctx.extent),
    heightEmu: hasHeight ? resolveDimensionEmu(props.h, 'Y', ctx.extent) : 0,
    ...(hasWidth ? {} : { autoWidth: true }),
    ...(hasHeight ? {} : { autoHeight: true }),
  };
}

function toEmuList(
  value: number | number[] | undefined,
  axis: 'X' | 'Y',
  ctx: CompileContext
): number[] {
  if (value === undefined) return [];
  const values = Array.isArray(value) ? value : [value];
  return values.map((v) => resolveDimensionEmu(v, axis, ctx.extent));
}

/**
 * One cell of the header row, as the theme would have it.
 *
 * Every part of this yields to something the author said. A cell that states
 * its own weight, fill or colour keeps it; so does a table that states a fill
 * or a colour for all of its cells, because "this table is green" is a
 * statement about the header too. What is left is the case nobody spoke for,
 * where the header takes `background2` behind `text` — the pair every bundled
 * palette carries for a band that reads as chrome.
 */
function headerCell(
  cell: PptxIrTableCell,
  tableProps: Record<string, any>,
  ctx: CompileContext
): PptxIrTableCell {
  const formatting: PptxIrTableCellFormatting = {
    bold: true,
    ...(tableProps.color
      ? {}
      : { color: irColor(resolveColor('text', ctx.theme, ctx.warnings)) }),
    ...cell.formatting,
  };
  const fill =
    cell.fill ??
    (tableProps.fill
      ? undefined
      : irColor(resolveColor('background2', ctx.theme, ctx.warnings)));
  return {
    ...cell,
    formatting,
    ...(fill ? { fill } : {}),
  };
}

function compileTableDefaults(
  props: Record<string, any>,
  ctx: CompileContext
): PptxIrTableFormatting {
  const family = (props.fontFace as string | undefined) ?? ctx.theme.fonts.body;
  let fontFamily = family;
  let bold: boolean | undefined;

  if (props.fontWeight != null) {
    const aliased = applyFontWeight({
      family,
      fontWeight: props.fontWeight as number,
    });
    if (aliased.fontFace !== undefined) fontFamily = aliased.fontFace;
    // Only ever true: a table-level `bold: false` is inert, because the cell
    // cascade ignores falsy table options.
    if (aliased.bold === true) bold = true;
  }

  return {
    fontFamily,
    fontSize:
      (props.fontSize as number | undefined) ?? ctx.theme.defaults.fontSize,
    ...(bold !== undefined ? { bold } : {}),
    ...(props.color
      ? { color: irColor(resolveColor(props.color, ctx.theme, ctx.warnings)) }
      : {}),
    ...(props.align
      ? { align: props.align as PptxIrTableFormatting['align'] }
      : {}),
    verticalAlign: (props.valign ??
      'middle') as PptxIrTableFormatting['verticalAlign'],
    ...(props.margin !== undefined
      ? { insetPoints: props.margin as PptxIrTableFormatting['insetPoints'] }
      : {}),
  };
}

function compileTableCell(
  cell: string | AuthoredTableCell,
  tableProps: Record<string, any>,
  ctx: CompileContext
): PptxIrTableCell {
  if (typeof cell === 'string') {
    return { text: forceTextPresentation(cell) };
  }

  const formatting: PptxIrTableCellFormatting = {};
  if (cell.color) {
    formatting.color = irColor(
      resolveColor(cell.color, ctx.theme, ctx.warnings)
    );
  }
  if (cell.fontSize) formatting.fontSize = cell.fontSize;
  if (cell.fontFace) formatting.fontFamily = cell.fontFace;
  // `!== undefined`, not truthiness: a table-level weight sets bold on every
  // cell that stays silent, so a cell meaning `false` has to say so.
  if (cell.bold !== undefined) formatting.bold = cell.bold;
  if (cell.italic) formatting.italic = true;

  if (cell.fontWeight != null || cell.bold !== undefined) {
    const aliased = applyFontWeight({
      family:
        cell.fontFace ??
        (tableProps.fontFace as string | undefined) ??
        ctx.theme.fonts.body,
      fontWeight: cell.fontWeight,
      italic: cell.italic,
      bold: cell.bold,
    });
    if (aliased.fontFace !== undefined)
      formatting.fontFamily = aliased.fontFace;
    if (aliased.bold !== undefined) formatting.bold = aliased.bold;
    if (aliased.italic !== undefined) formatting.italic = aliased.italic;
  }

  if (cell.align) {
    formatting.align = cell.align as PptxIrTableCellFormatting['align'];
  }
  if (cell.valign) {
    formatting.verticalAlign =
      cell.valign as PptxIrTableCellFormatting['verticalAlign'];
  }
  if (cell.margin !== undefined) {
    formatting.insetPoints =
      cell.margin as PptxIrTableCellFormatting['insetPoints'];
  }

  return {
    text: forceTextPresentation(cell.text),
    ...(Object.keys(formatting).length > 0 ? { formatting } : {}),
    ...(cell.fill
      ? { fill: irColor(resolveColor(cell.fill, ctx.theme, ctx.warnings)) }
      : {}),
    ...(cell.colspan !== undefined && cell.colspan > 1
      ? { colSpan: cell.colspan }
      : {}),
    ...(cell.rowspan !== undefined && cell.rowspan > 1
      ? { rowSpan: cell.rowspan }
      : {}),
  };
}

function compileTableBorder(
  border: { type?: string; pt?: number; color?: string } | undefined,
  ctx: CompileContext
): PptxIrTableBorder | undefined {
  if (!border) return undefined;
  return {
    type: (border.type ?? 'solid') as PptxIrTableBorder['type'],
    widthPoints: border.pt ?? 1,
    color: irColor(
      resolveColor(border.color ?? '000000', ctx.theme, ctx.warnings)
    ),
  };
}

/* ------------------------------------------------------------------ *
 * Charts
 * ------------------------------------------------------------------ */

const CHART_TYPES: readonly PptxIrChartType[] = [
  'area',
  'bar',
  'bar3D',
  'bubble',
  'doughnut',
  'line',
  'pie',
  'radar',
  'scatter',
];

interface AuthoredChartSeries {
  name?: string;
  labels?: string[];
  values?: number[];
  sizes?: number[];
}

/**
 * Which capability each styling prop demands of a backend.
 *
 * Keyed by the *authored* prop name rather than by anything on the compiled
 * IR, and that is the whole point. `compileChartLabelFont` falls back to
 * `ctx.theme.fonts?.body` when a weight is authored without a face, so a
 * compiled font object can hold a family the author never wrote; asking the IR
 * "was a font set here?" would demand `chart-text-style` of a chart that only
 * styled its weight. The authored props are the only place the question has a
 * straight answer.
 *
 * Props absent from this table are ones every backend already honours — `type`,
 * `data`, `title`, `showLegend`, `legendPos`, `chartColors`, the axis titles,
 * `barDir`, `barGrouping` and the geometry.
 */
const CHART_STYLE_FEATURES: Readonly<Record<string, PptxFeature>> = {
  showValue: 'chart-data-labels',
  showPercent: 'chart-data-labels',
  showLabel: 'chart-data-labels',
  showSerName: 'chart-data-labels',
  dataLabelPosition: 'chart-data-labels',

  dataBorder: 'chart-data-border',

  catAxisHidden: 'chart-axis-visibility',
  valAxisHidden: 'chart-axis-visibility',
  catAxisLineShow: 'chart-axis-visibility',
  valAxisLineShow: 'chart-axis-visibility',

  catAxisLabelRotate: 'chart-axis-style',
  catGridLine: 'chart-axis-style',
  valGridLine: 'chart-axis-style',

  valAxisMinVal: 'chart-axis-scale',
  valAxisMaxVal: 'chart-axis-scale',
  valAxisMajorUnit: 'chart-axis-scale',
  valAxisLabelFormatCode: 'chart-axis-scale',

  barGapWidthPct: 'chart-bar-style',
  barOverlapPct: 'chart-bar-style',

  firstSliceAng: 'chart-pie-style',
  holeSize: 'chart-pie-style',

  lineSmooth: 'chart-line-style',
  lineDataSymbol: 'chart-line-style',
  lineSize: 'chart-line-style',
  lineDataSymbolSize: 'chart-line-style',

  radarStyle: 'chart-radar-style',

  titleFontSize: 'chart-text-style',
  titleColor: 'chart-text-style',
  titleFontFace: 'chart-text-style',
  titleFontWeight: 'chart-text-style',
  legendFontSize: 'chart-text-style',
  legendFontFace: 'chart-text-style',
  legendFontWeight: 'chart-text-style',
  legendColor: 'chart-text-style',
  catAxisLabelFontSize: 'chart-text-style',
  catAxisLabelColor: 'chart-text-style',
  catAxisLabelFontFace: 'chart-text-style',
  catAxisLabelFontWeight: 'chart-text-style',
  valAxisLabelFontSize: 'chart-text-style',
  valAxisLabelColor: 'chart-text-style',
  valAxisLabelFontFace: 'chart-text-style',
  valAxisLabelFontWeight: 'chart-text-style',
  dataLabelColor: 'chart-text-style',
  dataLabelFontSize: 'chart-text-style',
  dataLabelFontFace: 'chart-text-style',
  dataLabelFontWeight: 'chart-text-style',
  dataLabelFontBold: 'chart-text-style',
};

/**
 * Record what this chart's styling demands of a backend.
 *
 * One requirement per authored prop, at that prop's own path, so a renderer
 * that cannot express it refuses naming the line rather than the chart. A prop
 * set to `undefined` is not authored; a prop set to `false` is — an author who
 * turns a data label off means it, and a backend that ignores the instruction
 * draws a label they asked not to see.
 */
function requireChartStyleFeatures(
  props: Record<string, unknown>,
  ctx: CompileContext,
  path: string
): void {
  for (const [prop, feature] of Object.entries(CHART_STYLE_FEATURES)) {
    if (props[prop] === undefined) continue;
    ctx.features.require(feature, `${path}.${prop}`);
  }
}

function compileChart(
  component: PptxComponentInput,
  scope: ComponentScope
): PptxIrElement | undefined {
  const { ctx, path } = scope;
  const props = component.props as Record<string, any>;

  const chartType = (CHART_TYPES as readonly string[]).includes(props.type)
    ? (props.type as PptxIrChartType)
    : undefined;
  if (!chartType) {
    warn(
      ctx.warnings,
      W.UNKNOWN_CHART_TYPE,
      `Unknown chart type: ${props.type}`,
      {
        component: 'chart',
      }
    );
    return undefined;
  }

  const authored = (props.data ?? []) as AuthoredChartSeries[];
  if (authored.length === 0) {
    warn(ctx.warnings, W.CHART_NO_DATA, 'Chart component has no data series', {
      component: 'chart',
    });
    return undefined;
  }
  for (const series of authored) {
    if (!series.labels || !series.values) {
      warn(
        ctx.warnings,
        W.CHART_INVALID_SERIES,
        `Chart series "${series.name ?? '(unnamed)'}" missing labels or values`,
        { component: 'chart' }
      );
      return undefined;
    }
  }
  if (
    (chartType === 'pie' || chartType === 'doughnut') &&
    authored.length > 1
  ) {
    warn(
      ctx.warnings,
      W.CHART_MULTI_SERIES,
      `${props.type} chart has ${authored.length} series — only the first will render`,
      { component: 'chart' }
    );
  }

  ctx.features.require('charts', path);
  requireChartStyleFeatures(props, ctx, path);

  return {
    kind: 'chart',
    id: scope.id,
    path,
    transform: shapeTransform(props, ctx),
    chartType,
    series: authored.map((series) => ({
      ...(series.name !== undefined ? { name: series.name } : {}),
      ...(series.labels ? { labels: series.labels } : {}),
      ...(series.values ? { values: series.values } : {}),
      ...(series.sizes ? { sizes: series.sizes } : {}),
    })),
    options: compileChartOptions(props, ctx),
  };
}

/**
 * Resolve a chart label font.
 *
 * PowerPoint chart labels carry no numeric weight, so a non-RIBBI weight only
 * survives as a synthesized sub-family ("Inter" at 300 → "Inter Light");
 * 400/700 stay on the family and use the slot's bold toggle. `hasBoldToggle`
 * is false for the legend, which has none — a weight that would need one is
 * reported rather than silently rendered as Regular.
 */
function compileChartLabelFont(
  ctx: CompileContext,
  slot: string,
  face: string | undefined,
  weight: number | undefined,
  hasBoldToggle: boolean,
  extra: {
    fontSize?: number;
    color?: PptxIrColor;
    /** Bold set alongside the weight; an explicit weight overrides it. */
    boldFallback?: boolean;
  } = {}
): PptxIrChartLabelFont {
  const { boldFallback, ...rest } = extra;
  const font: PptxIrChartLabelFont = { ...rest };
  if (boldFallback !== undefined) font.bold = boldFallback;

  if (weight === undefined) {
    if (face !== undefined) font.fontFamily = face;
    return font;
  }

  const aliased = applyFontWeight({
    family: face ?? ctx.theme.fonts?.body,
    fontWeight: weight,
  });
  if (aliased.fontFace !== undefined) font.fontFamily = aliased.fontFace;
  if (hasBoldToggle) {
    // Assign even when false: an explicit weight has to win over a bold
    // toggle set alongside it.
    font.bold = aliased.bold === true;
  } else if (aliased.bold === true) {
    warn(
      ctx.warnings,
      W.CHART_FONT_WEIGHT_DROPPED,
      `Chart ${slot} weight ${weight} renders as Regular — PowerPoint gives the legend no bold toggle, and only non-RIBBI weights resolve to a sub-family face`,
      { component: 'chart' }
    );
  }
  return font;
}

function compileChartOptions(
  props: Record<string, any>,
  ctx: CompileContext
): PptxIrChartOptions {
  // Author-supplied colours keep the loud fallback for an undefined token; the
  // implicit palette skips tokens the theme leaves unset or unresolvable, which
  // is what DOCX does too. An empty list stays empty so the backend uses its
  // own — a zero-length palette would paint every series black.
  const colorSources: string[] =
    props.chartColors ?? definedChartColorTokens(ctx.theme);
  const colors = colorSources.map((color) =>
    resolveColor(color, ctx.theme, ctx.warnings).toUpperCase()
  );

  const themeTextColor = irColor(resolveColor('text', ctx.theme, ctx.warnings));
  const resolved = (value: string | undefined): PptxIrColor =>
    value
      ? irColor(resolveColor(value, ctx.theme, ctx.warnings))
      : themeTextColor;

  return {
    colors,

    ...pick(props, {
      showLegend: 'showLegend',
      showTitle: 'showTitle',
      showValue: 'showValue',
      showPercent: 'showPercent',
      showLabel: 'showLabel',
      showSeriesName: 'showSerName',
    }),

    ...(props.title !== undefined ? { title: props.title as string } : {}),
    titleFont: compileChartLabelFont(
      ctx,
      'titleFontFace',
      props.titleFontFace,
      props.titleFontWeight,
      true,
      {
        ...(props.titleFontSize !== undefined
          ? { fontSize: props.titleFontSize as number }
          : {}),
        color: resolved(props.titleColor),
      }
    ),

    ...(props.legendPos !== undefined
      ? { legendPosition: props.legendPos as string }
      : {}),
    legendFont: compileChartLabelFont(
      ctx,
      'legendFontFace',
      props.legendFontFace,
      props.legendFontWeight,
      false,
      {
        ...(props.legendFontSize !== undefined
          ? { fontSize: props.legendFontSize as number }
          : {}),
        color: resolved(props.legendColor),
      }
    ),

    categoryAxis: {
      ...(props.catAxisTitle !== undefined
        ? { title: props.catAxisTitle as string }
        : {}),
      ...(props.catAxisHidden !== undefined
        ? { hidden: props.catAxisHidden as boolean }
        : {}),
      ...(props.catAxisLabelRotate !== undefined
        ? { labelRotate: props.catAxisLabelRotate as number }
        : {}),
      ...(props.catAxisLineShow !== undefined
        ? { showLine: props.catAxisLineShow as boolean }
        : {}),
      ...(props.catGridLine !== undefined
        ? { gridLine: compileGridLine(props.catGridLine, ctx) }
        : {}),
      labelFont: compileChartLabelFont(
        ctx,
        'catAxisLabelFontFace',
        props.catAxisLabelFontFace,
        props.catAxisLabelFontWeight,
        true,
        {
          ...(props.catAxisLabelFontSize !== undefined
            ? { fontSize: props.catAxisLabelFontSize as number }
            : {}),
          color: resolved(props.catAxisLabelColor),
        }
      ),
    },

    valueAxis: {
      ...(props.valAxisTitle !== undefined
        ? { title: props.valAxisTitle as string }
        : {}),
      ...(props.valAxisHidden !== undefined
        ? { hidden: props.valAxisHidden as boolean }
        : {}),
      ...(props.valAxisMinVal !== undefined
        ? { minValue: props.valAxisMinVal as number }
        : {}),
      ...(props.valAxisMaxVal !== undefined
        ? { maxValue: props.valAxisMaxVal as number }
        : {}),
      ...(props.valAxisMajorUnit !== undefined
        ? { majorUnit: props.valAxisMajorUnit as number }
        : {}),
      ...(props.valAxisLabelFormatCode !== undefined
        ? { labelFormatCode: props.valAxisLabelFormatCode as string }
        : {}),
      ...(props.valAxisLineShow !== undefined
        ? { showLine: props.valAxisLineShow as boolean }
        : {}),
      ...(props.valGridLine !== undefined
        ? { gridLine: compileGridLine(props.valGridLine, ctx) }
        : {}),
      labelFont: compileChartLabelFont(
        ctx,
        'valAxisLabelFontFace',
        props.valAxisLabelFontFace,
        props.valAxisLabelFontWeight,
        true,
        {
          ...(props.valAxisLabelFontSize !== undefined
            ? { fontSize: props.valAxisLabelFontSize as number }
            : {}),
          color: resolved(props.valAxisLabelColor),
        }
      ),
    },

    ...(props.dataBorder !== undefined
      ? {
          dataBorder: {
            widthPoints: props.dataBorder.pt as number,
            color: irColor(
              resolveColor(props.dataBorder.color, ctx.theme, ctx.warnings)
            ),
          },
        }
      : {}),
    dataLabelFont: compileChartLabelFont(
      ctx,
      'dataLabelFontFace',
      props.dataLabelFontFace,
      props.dataLabelFontWeight,
      true,
      {
        ...(props.dataLabelFontSize !== undefined
          ? { fontSize: props.dataLabelFontSize as number }
          : {}),
        color: resolved(props.dataLabelColor),
        ...(props.dataLabelFontBold !== undefined
          ? { boldFallback: props.dataLabelFontBold as boolean }
          : {}),
      }
    ),
    ...(props.dataLabelPosition !== undefined
      ? { dataLabelPosition: props.dataLabelPosition as string }
      : {}),

    ...pick(props, {
      barDirection: 'barDir',
      barGrouping: 'barGrouping',
      barGapWidthPercent: 'barGapWidthPct',
      barOverlapPercent: 'barOverlapPct',
      lineSmooth: 'lineSmooth',
      lineDataSymbol: 'lineDataSymbol',
      lineSize: 'lineSize',
      lineDataSymbolSize: 'lineDataSymbolSize',
      firstSliceAngle: 'firstSliceAng',
      holeSize: 'holeSize',
      radarStyle: 'radarStyle',
    }),
  };
}

/** Copy authored props onto IR names, skipping anything the author omitted. */
function pick(
  props: Record<string, any>,
  mapping: Record<string, string>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [irName, authoredName] of Object.entries(mapping)) {
    if (props[authoredName] !== undefined) out[irName] = props[authoredName];
  }
  return out;
}

function compileGridLine(
  gridLine: { style?: string; size?: number; color?: string },
  ctx: CompileContext
): PptxIrChartGridLine {
  return {
    ...(gridLine.style !== undefined ? { style: gridLine.style } : {}),
    ...(gridLine.size !== undefined ? { size: gridLine.size } : {}),
    ...(gridLine.color !== undefined
      ? {
          color: irColor(resolveColor(gridLine.color, ctx.theme, ctx.warnings)),
        }
      : {}),
  };
}

/* ------------------------------------------------------------------ *
 * Shared: fills, lines, shadows, hyperlinks, backgrounds
 * ------------------------------------------------------------------ */

function compileBackground(
  background:
    | {
        color?: string;
        gradient?: unknown;
        image?: { path?: string; base64?: string };
      }
    | undefined,
  path: string,
  ctx: CompileContext
): PptxIrBackground | undefined {
  if (!background) return undefined;

  if (background.color) {
    return {
      kind: 'solid',
      color: irColor(resolveColor(background.color, ctx.theme, ctx.warnings)),
    };
  }

  if (background.image) {
    const source = resolveImageSource(background.image);
    if (!source) return undefined;
    const resourceId = internImageSource(source, path, ctx);
    return resourceId === undefined ? undefined : { kind: 'image', resourceId };
  }

  return undefined;
}

function compileFill(
  fill:
    | {
        color?: string;
        transparency?: number;
        gradient?: unknown;
        pattern?: { preset: string; foreground: string; background: string };
      }
    | undefined,
  path: string,
  ctx: CompileContext
): PptxIrFill | undefined {
  if (!fill) return undefined;

  let gradient = fill.gradient;
  let pattern = fill.pattern;

  if (gradient && pattern) {
    warn(
      ctx.warnings,
      W.ADVANCED_FILL_FALLBACK,
      'Shape fill sets both "gradient" and "pattern" — using the gradient',
      { component: 'shape' }
    );
    pattern = undefined;
  }

  let unknownPresetForeground: string | undefined;
  if (
    pattern &&
    !(PATTERN_FILL_PRESETS as readonly string[]).includes(pattern.preset)
  ) {
    warn(
      ctx.warnings,
      W.UNKNOWN_PATTERN_PRESET,
      `Unknown pattern preset "${pattern.preset}" — falling back to solid foreground`,
      { component: 'shape' }
    );
    unknownPresetForeground = pattern.foreground;
    pattern = undefined;
  }

  if (gradient) {
    const compiled = compileGradient(gradient, path, ctx);
    if (compiled) return { kind: 'gradient', gradient: compiled };
  }

  if (pattern) {
    return {
      kind: 'pattern',
      preset: pattern.preset,
      foreground: irColor(
        resolveColor(pattern.foreground, ctx.theme, ctx.warnings)
      ),
      background: irColor(
        resolveColor(pattern.background, ctx.theme, ctx.warnings)
      ),
    };
  }

  const solid = fill.color ?? unknownPresetForeground;
  if (solid === undefined) return undefined;
  return {
    kind: 'solid',
    color: irColor(
      resolveColor(solid, ctx.theme, ctx.warnings),
      fill.transparency
    ),
  };
}

function compileSolidFillFromProps(
  fill: { color: string; transparency?: number },
  path: string,
  ctx: CompileContext
): PptxIrFill | undefined {
  void path;
  return {
    kind: 'solid',
    color: irColor(
      resolveColor(fill.color, ctx.theme, ctx.warnings),
      fill.transparency
    ),
  };
}

function requireFillFeature(
  fill: PptxIrFill,
  path: string,
  ctx: CompileContext
): void {
  switch (fill.kind) {
    case 'solid':
      ctx.features.require('solid-fills', path);
      return;
    case 'gradient':
      ctx.features.require('gradient-fills', path);
      return;
    case 'pattern':
      ctx.features.require('pattern-fills', path);
      return;
    case 'image':
      ctx.features.require('image-fills', path);
      return;
    case 'none':
      return;
  }
}

function compileGradient(
  gradient: unknown,
  path: string,
  ctx: CompileContext
): PptxIrGradient | undefined {
  if (!gradient || typeof gradient !== 'object') return undefined;
  const source = gradient as {
    type?: string;
    angle?: number;
    focus?: string;
    stops?: Array<{ color: string; pos: number; transparency?: number }>;
  };
  const stops = (source.stops ?? []).map((stop) => ({
    position: stop.pos,
    color: irColor(
      resolveColor(stop.color, ctx.theme, ctx.warnings),
      stop.transparency
    ),
  }));
  if (stops.length === 0) {
    warn(
      ctx.warnings,
      W.ADVANCED_FILL_FALLBACK,
      `Gradient at ${path} has no stops — ignored`,
      { component: 'shape' }
    );
    return undefined;
  }

  if (source.type === 'radial') {
    return {
      type: 'radial',
      focus: (source.focus ?? 'center') as PptxIrGradient extends {
        focus: infer F;
      }
        ? F
        : never,
      stops,
    } as PptxIrGradient;
  }

  return {
    type: 'linear',
    angleDegrees: normalizeDegrees(source.angle ?? 0),
    stops,
  };
}

function compileLine(
  line: { color?: string; width?: number; dashType?: string } | undefined,
  ctx: CompileContext
): PptxIrLine | undefined {
  if (!line) return undefined;
  const compiled: PptxIrLine = {};
  if (line.color) {
    compiled.color = irColor(resolveColor(line.color, ctx.theme, ctx.warnings));
  }
  if (line.width !== undefined) compiled.widthPoints = line.width;
  if (line.dashType) compiled.dash = line.dashType as PptxIrLine['dash'];
  // An empty `line: {}` is an authored request for the format's default
  // outline, which is not the same as no outline at all.
  return compiled;
}

function compileShadow(
  shadow:
    | {
        type?: string;
        color?: string;
        blur?: number;
        offset?: number;
        angle?: number;
        opacity?: number;
      }
    | undefined,
  ctx: CompileContext
): PptxIrShadow | undefined {
  if (!shadow) return undefined;
  return {
    type: (shadow.type ?? 'outer') as PptxIrShadow['type'],
    color: irColor(
      resolveColor(shadow.color ?? '000000', ctx.theme, ctx.warnings)
    ),
    blurPoints: shadow.blur ?? 3,
    offsetPoints: shadow.offset ?? 3,
    angleDegrees: shadow.angle ?? 45,
    opacity: shadow.opacity ?? 0.5,
  };
}

/**
 * Compile a hyperlink, dropping unresolvable slide refs with a warning.
 *
 * An unresolved ref must never reach a renderer: it would emit a relationship
 * to a slide part that is not in the archive, which PowerPoint reports as a
 * damaged file.
 */
function compileHyperlink(
  hyperlink: HyperlinkProps | undefined,
  componentName: string,
  ctx: CompileContext,
  path: string
): PptxIrHyperlink | undefined {
  if (!hyperlink) return undefined;

  if (hyperlink.url) {
    ctx.features.require('external-links', path);
    return {
      kind: 'external',
      url: hyperlink.url,
      ...(hyperlink.tooltip ? { tooltip: hyperlink.tooltip } : {}),
    };
  }

  if (hyperlink.unresolvedSlideRef != null) {
    // HYPERLINK_SLIDE_UNRESOLVED lives outside the `W` registry (it is owned by
    // utils/hyperlink.ts), so push it the same way `applyHyperlink` does.
    ctx.warnings.push({
      code: HYPERLINK_SLIDE_UNRESOLVED,
      message:
        `hyperlink.slide ${hyperlink.unresolvedSlideRef} matches no slide in the generated ` +
        `presentation (slide disabled, or index out of range) — hyperlink dropped`,
      component: componentName,
    });
    return undefined;
  }

  if (hyperlink.slide) {
    ctx.features.require('internal-links', path);
    return {
      kind: 'slide',
      slideIndex: hyperlink.slide,
      ...(hyperlink.tooltip ? { tooltip: hyperlink.tooltip } : {}),
    };
  }

  return undefined;
}

function optionalTransform(
  x: number | undefined,
  y: number | undefined,
  w: number | undefined,
  h: number | undefined,
  ctx: CompileContext
): PptxIrTransform | undefined {
  if (x == null && y == null && w == null && h == null) return undefined;
  return {
    xEmu: inchesToEmu(x ?? 0),
    yEmu: inchesToEmu(y ?? 0),
    widthEmu: w != null ? inchesToEmu(w) : defaultWidthEmu(ctx.extent),
    heightEmu: h != null ? inchesToEmu(h) : 0,
  };
}
