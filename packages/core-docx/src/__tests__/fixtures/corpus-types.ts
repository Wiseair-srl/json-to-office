/**
 * The shape of a DOCX parity corpus case.
 *
 * The corpus is split by feature area across sibling files, all of which export
 * `CASES: CorpusCase[]`; `corpus.ts` concatenates them. Splitting it keeps each
 * area readable and lets areas grow independently.
 *
 * Every document must be deterministic — no clocks, no randomness, no network,
 * no local file paths — because a case is identified by the SHA-256 of the
 * package it produces.
 */

export interface CorpusCase {
  /** `area/what-it-covers`, unique across the whole corpus. */
  name: string;
  /** A `docx` root component. Typed loosely so fixtures stay readable. */
  document: unknown;
}
