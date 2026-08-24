/**
 * `{ document? | handle?, revision? }` → one concrete JSON document.
 *
 * Every document-taking tool starts here, so the inline and workspace paths
 * cannot drift: whichever the agent used, the tool body sees the same tree and
 * the same failure vocabulary.
 */

import { ERROR_CODES, failure, type Failure } from './errors.js';
import {
  DOCUMENT_SOURCE_RULE,
  type DocumentSourceInput,
  type SourceSummary,
} from './schema.js';
import { getWorkspaceStore, type WorkspaceStore } from './workspace-store.js';

export type { DocumentSourceInput, SourceSummary };

export type ResolvedDocument =
  | {
      ok: true;
      document: unknown;
      origin: 'inline';
    }
  | {
      ok: true;
      document: unknown;
      origin: 'workspace';
      handle: string;
      /** The revision actually read, which may be older than current when pinned. */
      revision: number;
    }
  | Failure;

/**
 * Resolve a document source.
 *
 * The store is a parameter rather than a module lookup so a tool can be tested
 * against a fake without touching the process-wide holder; it defaults to the
 * installed store, which is what production wants.
 */
export async function resolveDocumentSource(
  source: DocumentSourceInput,
  store: WorkspaceStore = getWorkspaceStore()
): Promise<ResolvedDocument> {
  const hasInline = source.document !== undefined && source.document !== null;
  const hasHandle =
    typeof source.handle === 'string' && source.handle.length > 0;

  if (hasInline && hasHandle) {
    return failure(
      ERROR_CODES.DOC_SOURCE_AMBIGUOUS,
      'Both `document` and `handle` were supplied.',
      { suggestion: DOCUMENT_SOURCE_RULE }
    );
  }
  if (!hasInline && !hasHandle) {
    return failure(
      ERROR_CODES.DOC_SOURCE_MISSING,
      'Neither `document` nor `handle` was supplied.',
      { suggestion: DOCUMENT_SOURCE_RULE }
    );
  }

  if (hasInline) {
    // `revision` alone is meaningless and usually means the agent meant to
    // send a handle too; saying so beats validating a document it did not
    // intend to send.
    if (source.revision !== undefined) {
      return failure(
        ERROR_CODES.DOC_SOURCE_AMBIGUOUS,
        '`revision` applies to `handle` and cannot be combined with inline `document`.',
        { suggestion: DOCUMENT_SOURCE_RULE }
      );
    }
    return { ok: true, document: source.document, origin: 'inline' };
  }

  const handle = source.handle as string;
  const read = await store.get(handle, {
    ...(source.revision !== undefined && { revision: source.revision }),
  });
  if (!read.ok) return read;

  return {
    ok: true,
    document: read.document,
    origin: 'workspace',
    handle,
    revision: read.record.revision,
  };
}

/**
 * Where the tool read the document from, for the caller's own bookkeeping.
 *
 * Every document-taking tool echoes this, so an agent can tell at a glance
 * whether the answer describes the JSON it sent or the workspace revision the
 * server holds — and, when pinned, which revision that actually was.
 */
export function sourceSummary(
  resolved: Extract<ResolvedDocument, { ok: true }>
): SourceSummary {
  return resolved.origin === 'workspace'
    ? {
        origin: 'workspace',
        handle: resolved.handle,
        revision: resolved.revision,
      }
    : { origin: 'inline' };
}

/**
 * Parse a document that arrived as a JSON string.
 *
 * Tools take `document` as an object, but a handful of callers (file contents,
 * `jto_docx_diff`'s two sides) hold text; a parse failure is the agent's
 * defect to fix, so it comes back structured like every other one.
 */
export function parseDocumentJson(
  text: string,
  path?: string
): { ok: true; document: unknown } | Failure {
  try {
    return { ok: true, document: JSON.parse(text) };
  } catch (error) {
    return failure(
      ERROR_CODES.INVALID_JSON,
      error instanceof Error ? error.message : String(error),
      { ...(path !== undefined && { path }) }
    );
  }
}
