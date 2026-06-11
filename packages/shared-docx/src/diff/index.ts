/**
 * Document diff — "git diff for documents, reviewed in Word"
 *
 * Compares two DOCX JSON definitions and produces a renderable redline
 * document with native Word tracked changes.
 */

export {
  diffDocuments,
  type JsonNode,
  type DiffDocumentsOptions,
  type DiffDocumentsResult,
  type DiffSummary,
  type UntrackedChange,
} from './document-diff';

export {
  diffWords,
  stripMarkdown,
  tokenizeWords,
  type DiffSegment,
} from './word-diff';
