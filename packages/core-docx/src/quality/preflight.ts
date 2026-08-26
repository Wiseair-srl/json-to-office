/**
 * Design-quality collectors for DOCX documents (#216, #218).
 *
 * Flowing text cannot overflow a page the way a fixed slide box can, so the
 * DOCX rules are the deterministic layout mistakes that survive schema
 * validation: fixed table widths no page can hold, and heading levels that
 * skip a step and break the document outline. Findings are warnings and
 * infos, never errors — generation is not gated on taste.
 *
 * Quality runs after the same normalization, theme/default resolution and
 * page setup used by generation. It therefore checks the authored table
 * against its actual section instead of a mirrored page-size constant.
 */

import { QUALITY_CODES, type QualityFinding } from '@json-to-office/shared';
import type { ComponentDefinition, ReportComponentDefinition } from '../types';
import type { ThemeConfig } from '../styles';
import { resolveThemeContext } from '../core/generationContext';
import { createSectionProperties, getColumnSettings } from '../core/layout';
import { resolveDocumentTree } from '../core/structure';
import { normalizeDocument } from '../json/normalizer';
import { relativeLengthToTwips } from '../utils/widthUtils';

/** Half a point: enough to absorb integer-twip rounding. */
const WIDTH_TOLERANCE_TWIPS = 10;

type Rec = Record<string, unknown>;

function asRecord(value: unknown): Rec | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Rec)
    : undefined;
}

function checkTable(
  props: Rec,
  path: string,
  availableWidthTwips: number,
  findings: QualityFinding[]
) {
  const columns = Array.isArray(props.columns) ? props.columns : undefined;
  if (!columns) return;

  let totalTwips = 0;
  let hasExplicitWidth = false;
  for (const column of columns) {
    const width = asRecord(column)?.width;
    if (
      (typeof width === 'number' && Number.isFinite(width)) ||
      typeof width === 'string'
    ) {
      hasExplicitWidth = true;
      totalTwips += relativeLengthToTwips(width, availableWidthTwips);
    }
  }

  if (
    !hasExplicitWidth ||
    totalTwips <= availableWidthTwips + WIDTH_TOLERANCE_TWIPS
  )
    return;

  const totalPt = Math.round((totalTwips / 20) * 10) / 10;
  const availablePt = Math.round((availableWidthTwips / 20) * 10) / 10;
  findings.push({
    code: QUALITY_CODES.TABLE_WIDTH_OVERFLOW,
    severity: 'warning',
    message: `Column widths use ${totalPt}pt, but this section has ${availablePt}pt available — the table will spill off the right edge.`,
    path: `${path}/props/columns`,
    suggestion:
      'Reduce fixed/percentage widths, widen the page, or leave columns unsized so they share the remainder.',
    context: {
      totalWidthPt: totalPt,
      availableWidthPt: availablePt,
      // Kept for clients that consumed the original fixed-only diagnostic.
      pointSum: columns.reduce((sum, column) => {
        const width = asRecord(column)?.width;
        return typeof width === 'number' && Number.isFinite(width)
          ? sum + width
          : sum;
      }, 0),
      percentSum: columns.reduce((sum, column) => {
        const width = asRecord(column)?.width;
        if (typeof width !== 'string' || !width.trim().endsWith('%')) {
          return sum;
        }
        const percent = Number(width.trim().slice(0, -1));
        return Number.isFinite(percent) ? sum + percent : sum;
      }, 0),
    },
  });
}

/**
 * Walk the component tree in document order. Only `children` arrays are
 * descended — that is where every container puts its components — so a text
 * value that happens to contain the word "heading" can never be mistaken for
 * one.
 */
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

/**
 * Every design-quality finding for a DOCX document.
 *
 * Tolerant of any input shape: a document that is not even schema-valid gets
 * whatever findings its recognizable parts support, and never a throw.
 */
export interface DocxQualityOptions {
  customThemes?: Record<string, ThemeConfig>;
}

export function collectDocxQualityFindings(
  doc: unknown,
  options: DocxQualityOptions = {}
): QualityFinding[] {
  const findings: QualityFinding[] = [];
  const root = asRecord(doc);
  if (!root || root.name !== 'docx') return findings;

  try {
    const [normalized] = normalizeDocument(
      root as unknown as ReportComponentDefinition
    );
    const context = resolveThemeContext(normalized, {
      customThemes: options.customThemes,
      warnings: [],
    });
    const resolved = resolveDocumentTree(context.document, context.theme);
    const baseWidth = availableWidth(resolved.theme, context.themeName);
    let previousHeadingLevel: number | undefined;

    const visit = (node: Rec, path: string, availableWidthTwips: number) => {
      const props = asRecord(node.props) ?? {};

      if (node.name === 'table') {
        checkTable(props, path, availableWidthTwips, findings);
      }

      if (node.name === 'heading') {
        const level =
          typeof props.level === 'number' && Number.isFinite(props.level)
            ? props.level
            : 1;
        if (
          previousHeadingLevel !== undefined &&
          level > previousHeadingLevel + 1
        ) {
          findings.push({
            code: QUALITY_CODES.HEADING_SKIP,
            severity: 'info',
            message: `Heading level ${level} follows level ${previousHeadingLevel} — the skipped level breaks the document outline.`,
            path: `${path}/props/level`,
            suggestion: `Use level ${previousHeadingLevel + 1}, or promote this heading's section.`,
            context: { level, previousLevel: previousHeadingLevel },
          });
        }
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
  } catch {
    // Structural validation owns malformed trees; quality remains additive.
  }

  return findings;
}
