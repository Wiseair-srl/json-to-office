import type { FormatName } from './env';
type BaseFile = {
  name: string;
  type: string;
  mtime: Date; // when content was last changed
  ctime: Date; // when metadata was last changed
  atime: Date; // when file was last accessed
};

export type TextFile = BaseFile & {
  text: string;
};

export type BinaryFile = BaseFile & {
  blob: Blob;
};

export type Mode = 'create' | 'update' | 'delete';

export type Settings = {
  saveDocumentDebounceWait: number; // in milliseconds
  /**
   * Backend that turns the document into bytes, by renderer id.
   *
   * Undefined means the format's own default. The valid ids come from
   * `GET /api/<format>/renderers` rather than being listed here, so the
   * playground cannot offer a backend the server does not have.
   */
  generationBackend?: string;
  // UI: when true, show a single preview header spanning the editor + preview
  useGlobalPreviewHeader?: boolean;
  /**
   * Design profile the quality analysis runs under, by format then profile id.
   *
   * Keyed by format because settings persist to one localStorage key and both
   * playgrounds are served from the same origin: a single field would mean the
   * DOCX choice arrives on the PPTX playground, where it names no registered
   * profile. An absent entry means the format's own default profile.
   */
  qualityProfileIds?: Partial<Record<FormatName, string>>;
  /**
   * Lowest severity that makes the run policy reject a generation.
   *
   * `'none'` lets every build through; the analysis still runs and still
   * reports, it just cannot block.
   */
  qualityGate?: 'none' | 'error' | 'warning' | 'info';
  /** Lowest severity the panel shows. A display filter, never a gate. */
  qualityMinSeverity?: 'error' | 'warning' | 'info';
};
