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

export type RenderingLibrary = 'docxjs' | 'LibreOffice';

export type Settings = {
  saveDocumentDebounceWait: number; // in milliseconds
  autoReload: boolean; // whether to automatically reload preview on changes
  renderingLibrary: RenderingLibrary;
  // UI: when true, show a single preview header spanning the editor + preview
  useGlobalPreviewHeader?: boolean;
};
