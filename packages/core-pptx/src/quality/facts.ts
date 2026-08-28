import type {
  PreparedDocument,
  ProvenanceMap,
  QualityFact,
} from '@json-to-office/quality';
import type { FontRuntimeOpts, ServicesConfig } from '@json-to-office/shared';
import { DEFAULT_PPTX_RENDERER_ID } from '@json-to-office/shared-pptx';
import type {
  GridConfig,
  GridPosition,
  PipelineWarning,
  PptxComponentInput,
  PptxThemeConfig,
  PresentationComponentDefinition,
  ProcessedPresentation,
  TextStyle,
} from '../types';
import { resolveColor } from '../utils/color';
import { mergeGridConfigs, resolveGridPosition } from '../core/grid';
import { resolveThemeContext } from '../core/generationContext';
import { resolvePlaceholderComponents } from '../core/placeholders';
import { processPresentation } from '../core/structure';

type Rec = Record<string, unknown>;

export interface PptxCanvasFact extends QualityFact {
  kind: 'pptx/canvas';
  widthIn?: number;
  heightIn?: number;
}

export interface PptxTextFact extends QualityFact {
  kind: 'pptx/text';
  slidePath: string;
  text: string;
  fontSizePt: number;
  lineSpacingPt: number;
  paraSpaceBeforePt: number;
  paraSpaceAfterPt: number;
  styleName?: string;
  boxXPt?: number;
  boxYPt?: number;
  boxWidthPt?: number;
  boxHeightPt?: number;
  verticalAlign: 'top' | 'middle' | 'bottom';
  rotationDeg: number;
  /**
   * True when neither `h` nor a grid supplies a height. The compiler resolves
   * grid positions before checking `props.h`, so grid height is a hard ceiling.
   */
  autoFit: boolean;
  /** Resolved run colour, bare hex, when the document states one. */
  colorHex?: string;
  /**
   * Every colour the surface behind this text can paint, bare hex. A gradient
   * contributes each stop: text has to stay legible over all of them, and the
   * worst stop is the one a reader notices.
   */
  backgroundHexes?: readonly string[];
}

export interface PptxSlideFact extends QualityFact {
  kind: 'pptx/slide';
  bodyWords: number;
}

export type PptxQualityFact = PptxCanvasFact | PptxTextFact | PptxSlideFact;

export interface PptxQualityModel {
  authored: PresentationComponentDefinition;
  document: PresentationComponentDefinition;
  theme: PptxThemeConfig;
  processed: ProcessedPresentation;
}

export interface PreparePptxQualityOptions {
  customThemes?: Record<string, PptxThemeConfig>;
  fonts?: FontRuntimeOpts;
  services?: ServicesConfig;
  warnings?: PipelineWarning[];
  renderer?: string;
}

interface ThemeContext {
  styles: Partial<Record<string, TextStyle>>;
  defaultFontSize: number;
}

interface Typography {
  fontSize: number;
  lineSpacing: number;
  paraSpaceBefore: number;
  paraSpaceAfter: number;
  styleName?: string;
}

interface TextNode {
  props: Rec;
  path: string;
  text: string;
  /** Draw order on the slide, shared with `Surface`. */
  order: number;
}

interface ComponentAtPath {
  component: PptxComponentInput;
  path: string;
}

function asRecord(value: unknown): Rec | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Rec)
    : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

/** An x/y/w/h prop in points: inches as numbers, `"NN%"` of the axis. */
function dimToPt(value: unknown, axisIn: number): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value * 72;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.endsWith('%')) {
      const pct = Number(trimmed.slice(0, -1));
      return Number.isFinite(pct) ? (pct / 100) * axisIn * 72 : undefined;
    }
    const inches = Number(trimmed);
    return Number.isFinite(inches) ? inches * 72 : undefined;
  }
  return undefined;
}

interface Box {
  xPt: number;
  yPt: number;
  widthPt: number;
  heightPt: number;
}

/** Absolute box in points, falling back to the grid when x/y/w/h are absent. */
function resolveBox(
  props: Rec,
  grid: GridConfig | undefined,
  slideWidthIn: number,
  slideHeightIn: number
): Partial<Box> {
  let xPt = dimToPt(props.x, slideWidthIn);
  let yPt = dimToPt(props.y, slideHeightIn);
  let widthPt = dimToPt(props.w, slideWidthIn);
  let heightPt = dimToPt(props.h, slideHeightIn);
  const gridPos = asRecord(props.grid);
  if (
    gridPos !== undefined &&
    asNumber(gridPos.column) !== undefined &&
    asNumber(gridPos.row) !== undefined &&
    (xPt === undefined ||
      yPt === undefined ||
      widthPt === undefined ||
      heightPt === undefined)
  ) {
    const resolved = resolveGridPosition(
      gridPos as unknown as GridPosition,
      grid,
      slideWidthIn,
      slideHeightIn
    );
    xPt ??= resolved.x * 72;
    yPt ??= resolved.y * 72;
    widthPt ??= resolved.w * 72;
    heightPt ??= resolved.h * 72;
  }
  return { xPt, yPt, widthPt, heightPt };
}

function isCompleteBox(box: Partial<Box>): box is Box {
  return (
    box.xPt !== undefined &&
    box.yPt !== undefined &&
    box.widthPt !== undefined &&
    box.heightPt !== undefined &&
    box.widthPt > 0 &&
    box.heightPt > 0
  );
}

function containsCentre(surface: Box, text: Box): boolean {
  const cx = text.xPt + text.widthPt / 2;
  const cy = text.yPt + text.heightPt / 2;
  return (
    cx >= surface.xPt &&
    cx <= surface.xPt + surface.widthPt &&
    cy >= surface.yPt &&
    cy <= surface.yPt + surface.heightPt
  );
}

function themeContext(theme: PptxThemeConfig): ThemeContext {
  return {
    styles: theme.styles ?? {},
    defaultFontSize: asNumber(theme.defaults?.fontSize) ?? 18,
  };
}

/**
 * Every colour a fill can paint, resolved to bare hex.
 *
 * Deliberately structural rather than typed against one fill shape: solid
 * fills, gradients and their stops all nest `color` somewhere, and a background
 * that paints no colour at all (an image) yields nothing, which is the honest
 * answer — the rule then stays quiet instead of guessing at a photograph.
 */
function fillColorHexes(fill: unknown, theme: PptxThemeConfig): string[] {
  const found: string[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const rec = asRecord(node);
    if (!rec) return;
    if (typeof rec.color === 'string') {
      const hex = resolveColor(rec.color, theme);
      if (hex) found.push(hex.toUpperCase());
    }
    for (const value of Object.values(rec)) {
      if (typeof value === 'object' && value !== null) visit(value);
    }
  };
  visit(fill);
  return [...new Set(found)];
}

const FOCUS_CORNERS: Readonly<Record<string, readonly [number, number]>> = {
  topLeft: [0, 0],
  topRight: [1, 0],
  bottomLeft: [0, 1],
  bottomRight: [1, 1],
};

function lerpHex(a: string, b: string, t: number): string {
  const pa = parseInt(a, 16);
  const pb = parseInt(b, 16);
  const mix = (shift: number): number =>
    Math.round(
      ((pa >> shift) & 255) +
        (((pb >> shift) & 255) - ((pa >> shift) & 255)) * t
    );
  return [mix(16), mix(8), mix(0)]
    .map((c) => c.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

/**
 * Where along a gradient the point (fx, fy) — both 0..1 across the surface —
 * falls. Radial gradients run outward from the named corner; linear ones run
 * along `angle`, measured clockwise from the x-axis with y pointing down.
 *
 * The radial radius is half the surface's diagonal in real units, which is not
 * an obvious choice — it is the one the renderer makes. Sampling the rendered
 * gradient across a 10 × 5.625in slide put the last stop at exactly half the
 * diagonal from the focus corner, and reproduced every probe: the corner
 * opposite the focus, the two edge midpoints (which a shape-independent model
 * gets wrong, because equal distances in normalized space are unequal on a
 * wide slide), and the centre.
 */
function gradientPosition(
  gradient: Rec,
  fx: number,
  fy: number,
  widthUnits: number,
  heightUnits: number
): number {
  if (gradient.type === 'radial') {
    const focus =
      FOCUS_CORNERS[
        typeof gradient.focus === 'string' ? gradient.focus : 'topLeft'
      ] ?? FOCUS_CORNERS.topLeft;
    const radius = Math.hypot(widthUnits, heightUnits) / 2;
    if (radius === 0) return 0;
    const distance = Math.hypot(
      (fx - focus[0]) * widthUnits,
      (fy - focus[1]) * heightUnits
    );
    return Math.min(1, distance / radius);
  }
  const angle = ((asNumber(gradient.angle) ?? 0) * Math.PI) / 180;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const min = Math.min(0, dx) + Math.min(0, dy);
  const max = Math.max(0, dx) + Math.max(0, dy);
  if (max === min) return 0;
  return Math.min(1, Math.max(0, (fx * dx + fy * dy - min) / (max - min)));
}

/**
 * The colour a fill actually paints at (fx, fy).
 *
 * Sampling matters for gradients: taking the worst stop instead would fail
 * black text against the blue end of a background whose peach end it never
 * touches, and every slide over a two-tone ground would carry a finding for
 * one colour or the other.
 */
function paintedColorHexes(
  fill: unknown,
  theme: PptxThemeConfig,
  fx: number,
  fy: number,
  widthUnits: number,
  heightUnits: number
): string[] {
  const rec = asRecord(fill);
  const gradient = asRecord(rec?.gradient);
  const stops = Array.isArray(gradient?.stops) ? gradient.stops : undefined;
  if (gradient && stops && stops.length > 0) {
    const parsed = stops
      .flatMap((stop) => {
        const entry = asRecord(stop);
        const color =
          typeof entry?.color === 'string' ? entry.color : undefined;
        if (!color) return [];
        const hex = resolveColor(color, theme);
        if (!hex) return [];
        return [{ pos: asNumber(entry?.pos) ?? 0, hex: hex.toUpperCase() }];
      })
      .sort((a, b) => a.pos - b.pos);
    if (parsed.length === 0) return [];
    const target =
      gradientPosition(gradient, fx, fy, widthUnits, heightUnits) * 100;
    if (target <= parsed[0].pos) return [parsed[0].hex];
    const last = parsed[parsed.length - 1];
    if (target >= last.pos) return [last.hex];
    for (let i = 1; i < parsed.length; i += 1) {
      const previous = parsed[i - 1];
      const next = parsed[i];
      if (target <= next.pos) {
        const span = next.pos - previous.pos;
        const t = span === 0 ? 0 : (target - previous.pos) / span;
        return [lerpHex(previous.hex, next.hex, t)];
      }
    }
    return [last.hex];
  }
  return fillColorHexes(fill, theme);
}

function defaultLineHeightPt(fontSize: number): number {
  if (fontSize >= 60) return fontSize * 1.05;
  if (fontSize >= 28) return fontSize * 1.15;
  return fontSize * 1.25;
}

/** Effective type: explicit prop → named style → theme default. */
function resolveTypography(props: Rec, ctx: ThemeContext): Typography {
  const styleName = typeof props.style === 'string' ? props.style : undefined;
  const style = styleName !== undefined ? ctx.styles[styleName] : undefined;
  const fontSize =
    asNumber(props.fontSize) ?? style?.fontSize ?? ctx.defaultFontSize;
  const multiple = asNumber(props.lineSpacingMultiple);
  const lineSpacing =
    multiple !== undefined
      ? fontSize * multiple
      : asNumber(props.lineSpacing) ??
        style?.lineSpacing ??
        defaultLineHeightPt(fontSize);

  return {
    fontSize,
    lineSpacing,
    paraSpaceBefore: asNumber(props.paraSpaceBefore) ?? 0,
    paraSpaceAfter:
      asNumber(props.paraSpaceAfter) ?? style?.paraSpaceAfter ?? 0,
    ...(styleName && { styleName }),
  };
}

/**
 * Anything that paints over the slide surface, in the order it is drawn.
 * `colorHexes` is empty for an image — it covers the background without
 * telling us what colour it puts there.
 */
interface Surface {
  order: number;
  props: Rec;
  isImage: boolean;
}

/**
 * One ordered pass over a slide's components: the text to analyse, and the
 * surfaces drawn behind it. Both need the same z-order, and z-order is just
 * the sequence the renderer walks, so they are collected together rather than
 * in two passes that could disagree.
 */
function collectSlideNodes(
  component: unknown,
  path: string,
  text: TextNode[],
  surfaces: Surface[],
  counter: { next: number }
): void {
  const rec = asRecord(component);
  if (!rec || rec.enabled === false) return;
  const props = asRecord(rec.props) ?? {};
  const order = counter.next++;

  if (rec.name === 'image' || rec.name === 'visual' || rec.name === 'chart') {
    surfaces.push({ order, props, isImage: true });
  } else if (rec.name === 'shape' && props.fill !== undefined) {
    surfaces.push({ order, props, isImage: false });
  }

  const content = typeof props.text === 'string' ? props.text : undefined;
  if (
    content !== undefined &&
    content.trim() !== '' &&
    props.runs === undefined
  ) {
    if (rec.name === 'text' || rec.name === 'shape') {
      text.push({ props, path, text: content, order });
    }
  }
  const children = Array.isArray(rec.children) ? rec.children : [];
  children.forEach((child, index) =>
    collectSlideNodes(
      child,
      `${path}/children/${index}`,
      text,
      surfaces,
      counter
    )
  );
}

function pointerSegment(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

function addSlideFacts(
  roots: ComponentAtPath[],
  slidePath: string,
  renderedIndex: number,
  grid: GridConfig | undefined,
  slideWidthIn: number,
  slideHeightIn: number,
  ctx: ThemeContext,
  theme: PptxThemeConfig,
  slideBackground: (fx: number, fy: number) => readonly string[],
  analyzedTextPaths: Set<string>,
  addFact: (fact: PptxQualityFact) => void
): void {
  const nodes: TextNode[] = [];
  const surfaces: Surface[] = [];
  const counter = { next: 0 };
  for (const root of roots) {
    collectSlideNodes(root.component, root.path, nodes, surfaces, counter);
  }
  const surfaceBoxes = surfaces.flatMap((surface) => {
    const box = resolveBox(surface.props, grid, slideWidthIn, slideHeightIn);
    return isCompleteBox(box) ? [{ ...surface, box }] : [];
  });

  let bodyWords = 0;
  nodes.forEach((node, nodeIndex) => {
    const typography = resolveTypography(node.props, ctx);
    if (
      typography.styleName !== 'title' &&
      typography.styleName !== 'subtitle'
    ) {
      bodyWords += node.text.split(/\s+/).filter(Boolean).length;
    }

    // Shared template objects count toward every slide's density, but their
    // authored path should be analyzed only once.
    if (analyzedTextPaths.has(node.path)) return;
    analyzedTextPaths.add(node.path);

    const gridPos = asRecord(node.props.grid);
    const nodeBox = resolveBox(node.props, grid, slideWidthIn, slideHeightIn);
    const {
      xPt: boxXPt,
      yPt: boxYPt,
      widthPt: boxWidthPt,
      heightPt: boxHeightPt,
    } = nodeBox;

    // What the text actually sits on: its own shape fill, else the topmost
    // earlier-drawn surface covering its centre, else the slide itself.
    // Skipping the occlusion step reads every white-on-blue card as white on
    // the slide's white ground, which is how a contrast rule earns a reputation
    // for crying wolf.
    // Sample the whole box, not just its middle. A text block laid across a
    // gradient has a legibility problem at its worst end, and a centre sample
    // reports the average — which is exactly the point where neither the light
    // nor the dark half of the ground is represented.
    const sampleFractions = (
      box: Partial<Box>,
      originX: number,
      originY: number,
      widthPt: number,
      heightPt: number
    ): Array<readonly [number, number]> => {
      if (!isCompleteBox(box) || widthPt <= 0 || heightPt <= 0) {
        return [[0.5, 0.5]];
      }
      const x0 = (box.xPt - originX) / widthPt;
      const x1 = (box.xPt + box.widthPt - originX) / widthPt;
      const y0 = (box.yPt - originY) / heightPt;
      const y1 = (box.yPt + box.heightPt - originY) / heightPt;
      return [
        [(x0 + x1) / 2, (y0 + y1) / 2],
        [x0, y0],
        [x1, y0],
        [x0, y1],
        [x1, y1],
      ];
    };
    const slideSamples = sampleFractions(
      nodeBox,
      0,
      0,
      slideWidthIn * 72,
      slideHeightIn * 72
    );
    const ownFill = [
      ...new Set(
        slideSamples.flatMap(([fx, fy]) =>
          paintedColorHexes(
            node.props.fill,
            theme,
            fx,
            fy,
            slideWidthIn,
            slideHeightIn
          )
        )
      ),
    ];
    let backgroundHexes: readonly string[] = [
      ...new Set(slideSamples.flatMap(([fx, fy]) => slideBackground(fx, fy))),
    ];
    let backgroundUnknown = false;
    if (ownFill.length > 0) {
      backgroundHexes = ownFill;
    } else if (isCompleteBox(nodeBox)) {
      const covering = surfaceBoxes
        .filter(
          (surface) =>
            surface.order < node.order && containsCentre(surface.box, nodeBox)
        )
        .pop();
      if (covering?.isImage) {
        // An image covers the ground but says nothing about its colour.
        backgroundUnknown = true;
      } else if (covering) {
        // Sample within the covering shape's own box, not the slide's.
        const fill = [
          ...new Set(
            sampleFractions(
              nodeBox,
              covering.box.xPt,
              covering.box.yPt,
              covering.box.widthPt,
              covering.box.heightPt
            ).flatMap(([fx, fy]) =>
              paintedColorHexes(
                covering.props.fill,
                theme,
                fx,
                fy,
                covering.box.widthPt / 72,
                covering.box.heightPt / 72
              )
            )
          ),
        ];
        if (fill.length > 0) backgroundHexes = fill;
        else backgroundUnknown = true;
      }
    }
    const colorHex =
      typeof node.props.color === 'string'
        ? resolveColor(node.props.color, theme)?.toUpperCase()
        : undefined;

    addFact({
      id: `pptx:text:${renderedIndex}:${nodeIndex}:${node.path}`,
      kind: 'pptx/text',
      path: node.path,
      slidePath,
      text: node.text,
      fontSizePt: typography.fontSize,
      lineSpacingPt: typography.lineSpacing,
      paraSpaceBeforePt: typography.paraSpaceBefore,
      paraSpaceAfterPt: typography.paraSpaceAfter,
      ...(typography.styleName && { styleName: typography.styleName }),
      ...(boxXPt !== undefined && { boxXPt }),
      ...(boxYPt !== undefined && { boxYPt }),
      ...(boxWidthPt !== undefined && boxWidthPt > 0 && { boxWidthPt }),
      ...(boxHeightPt !== undefined && boxHeightPt > 0 && { boxHeightPt }),
      verticalAlign:
        node.props.valign === 'middle' || node.props.valign === 'bottom'
          ? node.props.valign
          : 'top',
      rotationDeg: asNumber(node.props.rotate) ?? 0,
      autoFit: node.props.h === undefined && gridPos === undefined,
      ...(colorHex !== undefined && { colorHex }),
      ...(!backgroundUnknown &&
        backgroundHexes.length > 0 && { backgroundHexes }),
    });
  });

  addFact({
    id: `pptx:slide:${renderedIndex}:${slidePath}`,
    kind: 'pptx/slide',
    path: slidePath,
    bodyWords,
  });
}

export function preparePptxQualityDocument(
  document: PresentationComponentDefinition,
  options: PreparePptxQualityOptions = {}
): PreparedDocument<PptxQualityModel, PptxQualityFact> {
  const facts: PptxQualityFact[] = [];
  const provenance: Record<string, ProvenanceMap[string]> = {};
  const addFact = (fact: PptxQualityFact): void => {
    facts.push(fact);
    provenance[fact.id] = {
      path: fact.path,
      ...(fact.relatedPaths && { relatedPaths: fact.relatedPaths }),
    };
  };

  const props = asRecord(document.props) ?? {};
  addFact({
    id: 'pptx:canvas',
    kind: 'pptx/canvas',
    path: '/props',
    ...(asNumber(props.slideWidth) !== undefined && {
      widthIn: asNumber(props.slideWidth),
    }),
    ...(asNumber(props.slideHeight) !== undefined && {
      heightIn: asNumber(props.slideHeight),
    }),
  });

  const warnings = options.warnings ?? [];
  const context = resolveThemeContext(document, {
    customThemes: options.customThemes,
    fonts: options.fonts,
    warnings,
  });
  const processed = processPresentation(context.document, {
    theme: context.theme,
    customThemes: options.customThemes,
    services: options.services,
  });
  const ctx = themeContext(processed.theme);
  const authoredChildren = Array.isArray(document.children)
    ? document.children
    : [];
  const slideIndexes = authoredChildren.flatMap((child, index) => {
    const slide = asRecord(child);
    return slide?.name === 'slide' && slide.enabled !== false ? [index] : [];
  });
  const templateIndexes = new Map<string, number>();
  const templates = new Map(
    (processed.templates ?? []).map((template, index) => {
      templateIndexes.set(template.name, index);
      return [template.name, template] as const;
    })
  );
  const analyzedTextPaths = new Set<string>();

  processed.slides.forEach((slide, renderedIndex) => {
    const authoredIndex = slideIndexes[renderedIndex];
    if (authoredIndex === undefined) return;
    const slidePath = `/children/${authoredIndex}`;
    const authoredSlide = asRecord(authoredChildren[authoredIndex]);
    const authoredComponents = Array.isArray(authoredSlide?.children)
      ? authoredSlide.children
      : [];
    const template = slide.template ? templates.get(slide.template) : undefined;
    const effectiveGrid = mergeGridConfigs(processed.grid, template?.grid);
    const roots: ComponentAtPath[] = [];

    const templateIndex = template
      ? templateIndexes.get(template.name)
      : undefined;
    if (template && templateIndex !== undefined) {
      template.objects?.forEach((component, index) => {
        roots.push({
          component,
          path: `/props/templates/${templateIndex}/objects/${index}`,
        });
      });
    }

    slide.components.forEach((component, index) => {
      if (authoredComponents[index] === undefined) return;
      roots.push({
        component,
        path: `${slidePath}/children/${index}`,
      });
    });

    for (const resolved of resolvePlaceholderComponents(
      slide,
      template,
      effectiveGrid,
      {
        theme: processed.theme,
        slideWidth: processed.slideWidth,
        slideHeight: processed.slideHeight,
        slideIndex: renderedIndex,
        warnings,
      }
    )) {
      roots.push({
        component: resolved.component,
        path: `${slidePath}/props/placeholders/${pointerSegment(resolved.name)}`,
      });
    }

    addSlideFacts(
      roots,
      slidePath,
      renderedIndex,
      effectiveGrid,
      processed.slideWidth,
      processed.slideHeight,
      ctx,
      processed.theme,
      (fx, fy) =>
        paintedColorHexes(
          slide.background ?? template?.background ?? props.background,
          processed.theme,
          fx,
          fy,
          processed.slideWidth,
          processed.slideHeight
        ),
      analyzedTextPaths,
      addFact
    );
  });

  return {
    format: 'pptx',
    model: {
      authored: document,
      document: context.document,
      theme: context.theme,
      processed,
    },
    facts,
    provenance,
    renderer: options.renderer ?? DEFAULT_PPTX_RENDERER_ID,
  };
}
