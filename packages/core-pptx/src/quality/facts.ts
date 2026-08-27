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
  boxWidthPt?: number;
  boxHeightPt?: number;
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

function themeContext(theme: PptxThemeConfig): ThemeContext {
  return {
    styles: theme.styles ?? {},
    defaultFontSize: asNumber(theme.defaults?.fontSize) ?? 18,
  };
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

function collectTextNodes(component: unknown, path: string, out: TextNode[]) {
  const rec = asRecord(component);
  if (!rec || rec.enabled === false) return;
  const props = asRecord(rec.props) ?? {};
  const text = typeof props.text === 'string' ? props.text : undefined;
  if (text !== undefined && text.trim() !== '' && props.runs === undefined) {
    if (rec.name === 'text' || rec.name === 'shape') {
      out.push({ props, path, text });
    }
  }
  const children = Array.isArray(rec.children) ? rec.children : [];
  children.forEach((child, index) =>
    collectTextNodes(child, `${path}/children/${index}`, out)
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
  analyzedTextPaths: Set<string>,
  addFact: (fact: PptxQualityFact) => void
): void {
  const nodes: TextNode[] = [];
  for (const root of roots) collectTextNodes(root.component, root.path, nodes);

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

    let boxWidthPt = dimToPt(node.props.w, slideWidthIn);
    let boxHeightPt = dimToPt(node.props.h, slideHeightIn);
    const gridPos = asRecord(node.props.grid);
    if (
      gridPos !== undefined &&
      asNumber(gridPos.column) !== undefined &&
      asNumber(gridPos.row) !== undefined &&
      (boxWidthPt === undefined || boxHeightPt === undefined)
    ) {
      const resolved = resolveGridPosition(
        gridPos as unknown as GridPosition,
        grid,
        slideWidthIn,
        slideHeightIn
      );
      boxWidthPt ??= resolved.w * 72;
      boxHeightPt ??= resolved.h * 72;
    }

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
      ...(boxWidthPt !== undefined && boxWidthPt > 0 && { boxWidthPt }),
      ...(boxHeightPt !== undefined && boxHeightPt > 0 && { boxHeightPt }),
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
