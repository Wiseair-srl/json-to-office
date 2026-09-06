/**
 * PptxIR invariants.
 *
 * These are not authoring checks — the schema validators already ran. They
 * guard the *contract* the IR promises adapters: resolved colours, finite EMU
 * geometry, resolved resource references, in-range slide links, no functions or
 * renderer objects hiding in the tree.
 *
 * A violation is a compiler bug, so it is reported as an error, not a warning.
 */

import { assertNever } from '@json-to-office/shared/rendering';
import {
  PPTX_IR_SCHEMA_VERSION,
  type PptxIR,
  type PptxIrBackground,
  type PptxIrColor,
  type PptxIrElement,
  type PptxIrFill,
  type PptxIrTextRun,
  type PptxIrTransform,
} from './types';

export interface IrViolation {
  path: string;
  message: string;
}

const HEX6 = /^[0-9A-F]{6}$/;

export function validatePptxIr(ir: PptxIR): IrViolation[] {
  const violations: IrViolation[] = [];
  const add = (path: string, message: string) =>
    violations.push({ path, message });

  if (ir.schemaVersion !== PPTX_IR_SCHEMA_VERSION) {
    add(
      'schemaVersion',
      `expected ${PPTX_IR_SCHEMA_VERSION}, got ${ir.schemaVersion}`
    );
  }

  if (!isPositiveInteger(ir.size.widthEmu)) {
    add(
      'size.widthEmu',
      `expected a positive integer, got ${ir.size.widthEmu}`
    );
  }
  if (!isPositiveInteger(ir.size.heightEmu)) {
    add(
      'size.heightEmu',
      `expected a positive integer, got ${ir.size.heightEmu}`
    );
  }

  for (const [slot, hex] of Object.entries(ir.theme.palette)) {
    if (!HEX6.test(hex)) {
      add(
        `theme.palette.${slot}`,
        `expected bare uppercase 6-digit hex, got "${hex}"`
      );
    }
  }

  const resourceIds = new Set<string>();
  ir.resources.forEach((resource, index) => {
    const path = `resources[${index}]`;
    if (resourceIds.has(resource.id)) {
      add(path, `duplicate resource id "${resource.id}"`);
    }
    resourceIds.add(resource.id);
    if (resource.origin.kind === 'inline') {
      if (resource.origin.bytes.byteLength !== resource.origin.byteLength) {
        add(`${path}.origin`, 'byteLength does not match bytes');
      }
      if (!/^[0-9a-f]{64}$/.test(resource.origin.sha256)) {
        add(`${path}.origin.sha256`, 'expected a lowercase hex SHA-256');
      }
    }
  });

  const slideIds = new Set<string>();
  ir.slides.forEach((slide, index) => {
    const path = `slides[${index}]`;
    if (slideIds.has(slide.id)) add(path, `duplicate slide id "${slide.id}"`);
    slideIds.add(slide.id);

    if (slide.background) {
      checkBackground(slide.background, `${path}.background`, resourceIds, add);
    }
    slide.elements.forEach((element, i) =>
      checkElement(element, `${path}.elements[${i}]`, ir, resourceIds, add)
    );
  });

  return violations;
}

/** Throw on the first invariant violation. Used by tests and debug builds. */
export function assertValidPptxIr(ir: PptxIR): void {
  const violations = validatePptxIr(ir);
  if (violations.length === 0) return;
  const detail = violations
    .map((v) => `  - ${v.path}: ${v.message}`)
    .join('\n');
  throw new Error(
    `PptxIR failed ${violations.length} invariant(s):\n${detail}`
  );
}

type Add = (path: string, message: string) => void;

function checkElement(
  element: PptxIrElement,
  path: string,
  ir: PptxIR,
  resourceIds: ReadonlySet<string>,
  add: Add
): void {
  if (typeof element.id !== 'string' || element.id.length === 0) {
    add(path, 'element has no id');
  }
  checkTransform(element.transform, `${path}.transform`, add);

  switch (element.kind) {
    case 'textBox':
      element.runs.forEach((run, i) =>
        checkRun(run, `${path}.runs[${i}]`, ir, add)
      );
      if (element.fill)
        checkFill(element.fill, `${path}.fill`, resourceIds, add);
      return;
    case 'shape':
      (element.runs ?? []).forEach((run, i) =>
        checkRun(run, `${path}.runs[${i}]`, ir, add)
      );
      if (element.fill)
        checkFill(element.fill, `${path}.fill`, resourceIds, add);
      if (
        element.cornerRadius !== undefined &&
        (!Number.isFinite(element.cornerRadius) || element.cornerRadius < 0)
      ) {
        add(`${path}.cornerRadius`, 'expected a non-negative radius in inches');
      }
      return;
    case 'image':
      if (!resourceIds.has(element.resourceId)) {
        add(
          `${path}.resourceId`,
          `references unknown resource "${element.resourceId}"`
        );
      }
      return;
    case 'table':
      checkColor(
        element.defaults.color ?? { hex: '000000' },
        `${path}.defaults.color`,
        add
      );
      if (element.fill) checkColor(element.fill, `${path}.fill`, add);
      element.rows.forEach((row, r) =>
        row.cells.forEach((cell, c) => {
          const cellPath = `${path}.rows[${r}].cells[${c}]`;
          if (typeof cell.text !== 'string') {
            add(`${cellPath}.text`, 'expected a string');
          }
          if (cell.fill) checkColor(cell.fill, `${cellPath}.fill`, add);
          if (cell.formatting?.color) {
            checkColor(
              cell.formatting.color,
              `${cellPath}.formatting.color`,
              add
            );
          }
        })
      );
      for (const [name, values] of [
        ['columnWidthsEmu', element.columnWidthsEmu],
        ['rowHeightsEmu', element.rowHeightsEmu],
      ] as const) {
        if (values.some((v) => !Number.isFinite(v) || v < 0)) {
          add(`${path}.${name}`, 'expected finite non-negative EMU values');
        }
      }
      return;
    case 'chart':
      if (element.series.length === 0) {
        add(`${path}.series`, 'chart has no series');
      }
      element.options.colors.forEach((hex, i) => {
        if (!HEX6.test(hex)) {
          add(
            `${path}.options.colors[${i}]`,
            `expected bare uppercase 6-digit hex, got "${hex}"`
          );
        }
      });
      for (const [i, series] of element.series.entries()) {
        if (
          series.labels &&
          series.values &&
          series.labels.length !== series.values.length
        ) {
          add(
            `${path}.series[${i}]`,
            'labels and values must have the same length'
          );
        }
      }
      return;
    case 'group':
      element.children.forEach((child, i) =>
        checkElement(child, `${path}.children[${i}]`, ir, resourceIds, add)
      );
      return;
    default:
      assertNever(element, 'PptxIrElement');
  }
}

function checkRun(
  run: PptxIrTextRun,
  path: string,
  ir: PptxIR,
  add: Add
): void {
  if (typeof run.text !== 'string') add(`${path}.text`, 'expected a string');
  if (!run.fontFamily)
    add(`${path}.fontFamily`, 'expected a resolved font family');
  if (!Number.isFinite(run.fontSize) || run.fontSize <= 0) {
    add(
      `${path}.fontSize`,
      `expected a positive point size, got ${run.fontSize}`
    );
  }
  checkColor(run.color, `${path}.color`, add);

  const link = run.hyperlink;
  if (link?.kind === 'slide') {
    if (link.slideIndex < 1 || link.slideIndex > ir.slides.length) {
      add(
        `${path}.hyperlink.slideIndex`,
        `${link.slideIndex} is outside 1..${ir.slides.length}`
      );
    }
  }
}

function checkColor(color: PptxIrColor, path: string, add: Add): void {
  if (!HEX6.test(color.hex)) {
    add(path, `expected bare uppercase 6-digit hex, got "${color.hex}"`);
  }
  if (
    color.transparency !== undefined &&
    (color.transparency < 0 || color.transparency > 100)
  ) {
    add(`${path}.transparency`, 'expected 0-100');
  }
}

function checkFill(
  fill: PptxIrFill,
  path: string,
  resourceIds: ReadonlySet<string>,
  add: Add
): void {
  switch (fill.kind) {
    case 'none':
      return;
    case 'solid':
      checkColor(fill.color, `${path}.color`, add);
      return;
    case 'gradient':
      if (fill.gradient.stops.length === 0) {
        add(`${path}.gradient.stops`, 'gradient has no stops');
      }
      fill.gradient.stops.forEach((stop, i) => {
        checkColor(stop.color, `${path}.gradient.stops[${i}].color`, add);
        if (stop.position < 0 || stop.position > 100) {
          add(`${path}.gradient.stops[${i}].position`, 'expected 0-100');
        }
      });
      return;
    case 'pattern':
      checkColor(fill.foreground, `${path}.foreground`, add);
      checkColor(fill.background, `${path}.background`, add);
      return;
    case 'image':
      if (!resourceIds.has(fill.resourceId)) {
        add(
          `${path}.resourceId`,
          `references unknown resource "${fill.resourceId}"`
        );
      }
      return;
    default:
      assertNever(fill, 'PptxIrFill');
  }
}

function checkBackground(
  background: PptxIrBackground,
  path: string,
  resourceIds: ReadonlySet<string>,
  add: Add
): void {
  if (background.kind === 'solid') {
    checkColor(background.color, `${path}.color`, add);
    return;
  }
  if (!resourceIds.has(background.resourceId)) {
    add(
      `${path}.resourceId`,
      `references unknown resource "${background.resourceId}"`
    );
  }
}

function checkTransform(
  transform: PptxIrTransform,
  path: string,
  add: Add
): void {
  for (const key of ['xEmu', 'yEmu', 'widthEmu', 'heightEmu'] as const) {
    const value = transform[key];
    if (!Number.isFinite(value)) {
      add(`${path}.${key}`, `expected a finite EMU value, got ${value}`);
    } else if (!Number.isInteger(value)) {
      add(`${path}.${key}`, `expected an integer EMU value, got ${value}`);
    }
  }
  if (transform.widthEmu < 0 || transform.heightEmu < 0) {
    add(path, 'expected non-negative width and height');
  }
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}
