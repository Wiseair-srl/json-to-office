/**
 * PptxIR — internal to `@json-to-office/core-pptx` for this release.
 *
 * Deliberately not re-exported from `packages/core-pptx/src/index.ts`: the IR
 * shape is expected to move while the DOCX side of the migration lands, and
 * publishing it now would freeze it. See
 * `docs/architecture/office-renderer-ir.md`.
 */

export * from './types';
export * from './features';
export * from './units';
export * from './resources';
export { compilePresentation } from './compiler';
export type { PptxCompileResult, UnsupportedComponent } from './compiler';
export { assertValidPptxIr, validatePptxIr } from './validation';
export type { IrViolation } from './validation';
export { formatPptxIr, snapshotPptxIr } from './debug';
export type { PptxIrSnapshot } from './debug';
