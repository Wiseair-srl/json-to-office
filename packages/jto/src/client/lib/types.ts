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
};
