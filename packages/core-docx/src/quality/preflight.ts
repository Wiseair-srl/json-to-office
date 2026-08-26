/**
 * Design-quality collectors for DOCX documents (#216, #218).
 *
 * Flowing text cannot overflow a page the way a fixed slide box can, so the
 * DOCX rules are the deterministic layout mistakes that survive schema
 * validation: fixed table widths no page can hold, and heading levels that
 * skip a step and break the document outline. Findings are warnings and
 * infos, never errors — generation is not gated on taste.
 *
 * The precise table-width check against the real page geometry happens in the
 * IR compiler at render time; the rule here is the coarse early warning that
 * saves the render, so its bound is deliberately generous — wider than any
 * built-in page setup allows, not wider than the likeliest one.
 */

import { QUALITY_CODES, type QualityFinding } from '@json-to-office/shared';

/**
 * Usable text width of the roomiest plausible page: US Letter (612pt) with
 * 0.5" margins. A column sum past this overflows on every built-in theme;
 * sums between a theme's real width and this bound are left to the compiler's
 * exact check.
 */
const MAX_USABLE_WIDTH_PT = 540;

type Rec = Record<string, unknown>;

function asRecord(value: unknown): Rec | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Rec)
    : undefined;
}

function checkTable(props: Rec, path: string, findings: QualityFinding[]) {
  const columns = Array.isArray(props.columns) ? props.columns : undefined;
  if (!columns) return;

  let pointSum = 0;
  let percentSum = 0;
  for (const column of columns) {
    const width = asRecord(column)?.width;
    if (typeof width === 'number' && Number.isFinite(width)) {
      pointSum += width;
    } else if (typeof width === 'string' && width.trim().endsWith('%')) {
      const pct = Number(width.trim().slice(0, -1));
      if (Number.isFinite(pct)) percentSum += pct;
    }
  }

  if (pointSum > MAX_USABLE_WIDTH_PT) {
    findings.push({
      code: QUALITY_CODES.TABLE_WIDTH_OVERFLOW,
      severity: 'warning',
      message: `Column widths sum to ${pointSum}pt — wider than any page setup (max usable ≈ ${MAX_USABLE_WIDTH_PT}pt); the table will spill off the right edge.`,
      path: `${path}/props/columns`,
      suggestion:
        'Reduce the fixed widths, or leave some columns unsized so they share the leftover space.',
      context: { pointSum, maxUsableWidthPt: MAX_USABLE_WIDTH_PT },
    });
  } else if (percentSum > 100.5) {
    findings.push({
      code: QUALITY_CODES.TABLE_WIDTH_OVERFLOW,
      severity: 'warning',
      message: `Percentage column widths sum to ${percentSum}% — over 100%, the table will spill off the right edge.`,
      path: `${path}/props/columns`,
      suggestion: 'Make the percentage widths sum to at most 100%.',
      context: { percentSum },
    });
  }
}

/**
 * Walk the component tree in document order. Only `children` arrays are
 * descended — that is where every container puts its components — so a text
 * value that happens to contain the word "heading" can never be mistaken for
 * one.
 */
function walk(
  node: unknown,
  path: string,
  visit: (node: Rec, path: string) => void
): void {
  const rec = asRecord(node);
  if (!rec) return;
  visit(rec, path);
  const children = Array.isArray(rec.children) ? rec.children : [];
  children.forEach((child, index) =>
    walk(child, `${path}/children/${index}`, visit)
  );
}

/**
 * Every design-quality finding for a DOCX document.
 *
 * Tolerant of any input shape: a document that is not even schema-valid gets
 * whatever findings its recognizable parts support, and never a throw.
 */
export function collectDocxQualityFindings(doc: unknown): QualityFinding[] {
  const findings: QualityFinding[] = [];
  const root = asRecord(doc);
  if (!root || root.name !== 'docx') return findings;

  let previousHeadingLevel: number | undefined;

  walk(root, '', (node, path) => {
    if (path === '') return;
    const props = asRecord(node.props) ?? {};

    if (node.name === 'table') {
      checkTable(props, path, findings);
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
  });

  return findings;
}
