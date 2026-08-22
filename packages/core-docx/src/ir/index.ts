/**
 * DocxIR — internal to `@json-to-office/core-docx` for this release.
 *
 * Deliberately not re-exported from `packages/core-docx/src/index.ts`: the IR
 * shape is expected to move while the rest of the DOCX migration lands, and
 * publishing it now would freeze it. See
 * `docs/architecture/office-renderer-ir.md`.
 */

export * from './types';
export * from './features';
export * from './units';
export { assertValidDocxIr, validateDocxIr } from './validation';
export type { IrViolation } from './validation';
export { formatDocxIr, snapshotDocxIr } from './debug';
export type { DocxIrSnapshot } from './debug';
