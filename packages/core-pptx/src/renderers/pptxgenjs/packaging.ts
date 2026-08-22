/**
 * Packaging for PptxGenJS output.
 *
 * Two kinds of work happen after PptxGenJS writes its zip:
 *
 * 1. **Backend repairs** — the sentinel gradient/pattern splice, the
 *    hard-coded table-style GUID, and the SVG preview fix. These exist only
 *    because of what PptxGenJS emits, so they belong to this adapter.
 * 2. **Generic finalization** — deterministic ZIP entry timestamps, core
 *    metadata timestamps, canonical chart identifiers, recursive
 *    normalisation of embedded workbooks. Those are properties of an OOXML
 *    package, valid for any backend.
 *
 * Both currently run inside `core/packagePresentation.ts`, in one zip pass, and
 * that single pass is what today's byte-stable fixtures were produced by.
 * Splitting it into two passes is a packaging-ownership change that lands with
 * the default-renderer cutover, together with the byte-parity fixtures that
 * prove the split is inert. Until then this module is the adapter's seam: the
 * call site is here, so moving the implementation later touches one file.
 */

import {
  packagePresentationBuffer,
  type PresentationPackagingOptions,
} from '../../core/packagePresentation';
import type { PendingXmlFill } from './fills';
import type { PipelineWarning } from '../../types';

export interface PptxGenJsPackagingOptions {
  pendingFills?: readonly PendingXmlFill[];
  deterministic?: boolean;
  generatedAt?: Date | string;
  /** Sink for repairs that need to report, e.g. an SVG that cannot rasterize. */
  warnings?: PipelineWarning[];
}

export async function packagePptxGenJsBuffer(
  buffer: Buffer,
  options: PptxGenJsPackagingOptions = {}
): Promise<Buffer> {
  const packaging: PresentationPackagingOptions = {
    ...(options.pendingFills?.length
      ? { pendingFills: [...options.pendingFills] }
      : {}),
    ...(options.deterministic !== undefined
      ? { deterministic: options.deterministic }
      : {}),
    ...(options.generatedAt !== undefined
      ? { generatedAt: options.generatedAt }
      : {}),
    ...(options.warnings ? { warnings: options.warnings } : {}),
  };
  return packagePresentationBuffer(buffer, packaging);
}
