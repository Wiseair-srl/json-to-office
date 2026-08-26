import type {
  PreparedDocument,
  ProvenanceMap,
  QualityFact,
} from '@json-to-office/quality';
import type {
  FontRuntimeOpts,
  GenerationWarning,
} from '@json-to-office/shared';
import { DEFAULT_DOCX_RENDERER_ID } from '@json-to-office/shared-docx';
import type { ComponentDefinition, ReportComponentDefinition } from '../types';
import type { ThemeConfig } from '../styles';
import {
  resolveThemeContext,
  type GenerationThemeContext,
} from '../core/generationContext';
import { createSectionProperties, getColumnSettings } from '../core/layout';
import {
  resolveDocumentTree,
  type ResolvedDocumentTree,
} from '../core/structure';
import { normalizeDocument } from '../json/normalizer';
import { relativeLengthToTwips } from '../utils/widthUtils';

type Rec = Record<string, unknown>;

export interface DocxTableWidthFact extends QualityFact {
  kind: 'docx/table-width';
  totalWidthTwips: number;
  availableWidthTwips: number;
  hasExplicitWidth: boolean;
  pointSum: number;
  percentSum: number;
}

export interface DocxHeadingFact extends QualityFact {
  kind: 'docx/heading';
  level: number;
  previousLevel?: number;
}

export type DocxQualityFact = DocxTableWidthFact | DocxHeadingFact;

export interface DocxQualityModel {
  authored: ReportComponentDefinition;
  context: GenerationThemeContext;
  document: ResolvedDocumentTree;
  themeName: string;
}

export interface PrepareDocxQualityOptions {
  customThemes?: Record<string, ThemeConfig>;
  fonts?: FontRuntimeOpts;
  warnings?: GenerationWarning[];
  context?: GenerationThemeContext;
  renderer?: string;
}

function asRecord(value: unknown): Rec | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Rec)
    : undefined;
}

function availableWidth(
  theme: ThemeConfig,
  themeName: string,
  pageOverride?: unknown
): number {
  const page = createSectionProperties(
    getColumnSettings('single'),
    theme,
    themeName,
    'nextPage',
    pageOverride as Parameters<typeof createSectionProperties>[4]
  ).page;
  return Math.max(0, page.size.width - page.margin.left - page.margin.right);
}

function tableFact(
  props: Rec,
  path: string,
  availableWidthTwips: number
): DocxTableWidthFact | undefined {
  const columns = Array.isArray(props.columns) ? props.columns : undefined;
  if (!columns) return undefined;

  let totalWidthTwips = 0;
  let hasExplicitWidth = false;
  let pointSum = 0;
  let percentSum = 0;

  for (const column of columns) {
    const width = asRecord(column)?.width;
    if (
      (typeof width === 'number' && Number.isFinite(width)) ||
      typeof width === 'string'
    ) {
      hasExplicitWidth = true;
      totalWidthTwips += relativeLengthToTwips(width, availableWidthTwips);
    }
    if (typeof width === 'number' && Number.isFinite(width)) {
      pointSum += width;
    } else if (typeof width === 'string' && width.trim().endsWith('%')) {
      const percent = Number(width.trim().slice(0, -1));
      if (Number.isFinite(percent)) percentSum += percent;
    }
  }

  return {
    id: `docx:table-width:${path}`,
    kind: 'docx/table-width',
    path: `${path}/props/columns`,
    totalWidthTwips,
    availableWidthTwips,
    hasExplicitWidth,
    pointSum,
    percentSum,
  };
}

function walkActive(
  node: unknown,
  path: string,
  availableWidthTwips: number,
  visit: (node: Rec, path: string, availableWidthTwips: number) => void
): void {
  const rec = asRecord(node);
  if (!rec || rec.enabled === false) return;
  visit(rec, path, availableWidthTwips);
  const children = Array.isArray(rec.children) ? rec.children : [];
  children.forEach((child, index) =>
    walkActive(child, `${path}/children/${index}`, availableWidthTwips, visit)
  );
}

export function prepareDocxQualityDocument(
  document: ReportComponentDefinition,
  options: PrepareDocxQualityOptions = {}
): PreparedDocument<DocxQualityModel, DocxQualityFact> {
  const context =
    options.context ??
    resolveThemeContext(normalizeDocument(document)[0], {
      customThemes: options.customThemes,
      fonts: options.fonts,
      warnings: options.warnings,
    });
  const resolved = resolveDocumentTree(context.document, context.theme);
  const baseWidth = availableWidth(resolved.theme, context.themeName);
  const facts: DocxQualityFact[] = [];
  const provenance: Record<string, ProvenanceMap[string]> = {};
  let previousHeadingLevel: number | undefined;

  const addFact = (fact: DocxQualityFact): void => {
    facts.push(fact);
    provenance[fact.id] = {
      path: fact.path,
      ...(fact.relatedPaths && { relatedPaths: fact.relatedPaths }),
    };
  };

  const visit = (
    node: Rec,
    path: string,
    availableWidthTwips: number
  ): void => {
    const props = asRecord(node.props) ?? {};
    if (node.name === 'table') {
      const fact = tableFact(props, path, availableWidthTwips);
      if (fact) addFact(fact);
    }

    if (node.name === 'heading') {
      const level =
        typeof props.level === 'number' && Number.isFinite(props.level)
          ? props.level
          : 1;
      addFact({
        id: `docx:heading:${path}`,
        kind: 'docx/heading',
        path: `${path}/props/level`,
        level,
        ...(previousHeadingLevel !== undefined && {
          previousLevel: previousHeadingLevel,
        }),
      });
      previousHeadingLevel = level;
    }
  };

  resolved.children.forEach((component, index) => {
    const rec = component as ComponentDefinition & {
      props?: Record<string, unknown>;
    };
    const width =
      rec.name === 'section'
        ? availableWidth(resolved.theme, context.themeName, rec.props?.page)
        : baseWidth;
    walkActive(component, `/children/${index}`, width, visit);
  });

  return {
    format: 'docx',
    model: {
      authored: document,
      context,
      document: resolved,
      themeName: context.themeName,
    },
    facts,
    provenance,
    renderer: options.renderer ?? DEFAULT_DOCX_RENDERER_ID,
  };
}
