/**
 * Ordering tickets for quality analyses.
 *
 * Three independent producers write the same store slice: the editor's
 * debounced validate pass, the preview's immediate re-analysis after a fix,
 * and the build's own findings. Each aborts only its own in-flight request, so
 * per-request cancellation cannot order them against each other — a ~10s build
 * started before an edit still resolves after the validate pass that overtook
 * it, and would otherwise reinstate findings for text the editor no longer
 * holds.
 *
 * Every producer takes a ticket before it starts and drops its result if a
 * higher one has already landed. Tickets are process-wide because the writers
 * are separate hook instances in one bundle; a per-instance counter would
 * compare numbers that mean nothing to each other.
 */

import type { QualityState } from '../store/output-store';

let counter = 0;

/** Monotonic, allocated at the moment work starts, not when it finishes. */
export function nextQualityTicket(): number {
  counter += 1;
  return counter;
}

/** True when a newer analysis has already been committed. */
export function isStaleQualityTicket(
  current: QualityState | null | undefined,
  ticket: number
): boolean {
  return current != null && current.seq > ticket;
}
