import { persist, devtools, createJSONStorage } from 'zustand/middleware';
import { createStore } from 'zustand/vanilla';
import type { TextFile } from '../lib/types';
import { idbStorage } from '../lib/idb-storage';

const MAX_OPEN_TABS = 3;

/**
 * What a file in the workspace is: a document, a theme, or a plugin — the
 * TypeScript source of a custom component compiled and run in the browser.
 */
export type DocumentType =
  | 'application/json+report'
  | 'application/json+theme'
  | 'application/typescript+plugin';

/** File-name suffix that marks a plugin source, the same one disk discovery uses. */
export const PLUGIN_FILE_SUFFIX = '.component.ts';

export function isPluginDocumentName(name: string): boolean {
  return name.toLowerCase().endsWith(PLUGIN_FILE_SUFFIX);
}

/**
 * The file name a plugin will actually be stored under. The type is decided
 * by the name, so a plugin keeps its suffix however it is typed — which is
 * why duplicate checks have to run on this, not on what the author entered:
 * `foo` and `foo.component.ts` are the same file.
 */
export function pluginDocumentName(name: string): string {
  const trimmed = name.trim();
  if (isPluginDocumentName(trimmed)) return trimmed;
  return trimmed.replace(/\.(component)?\.?ts$/i, '') + PLUGIN_FILE_SUFFIX;
}

export type DocumentsState = {
  documents: TextFile[];
  openTabs: string[];
  activeTab: string;
  buildErrors: { [key: string]: string };
  documentTypes: { [key: string]: DocumentType };
  pendingDiffs: {
    [key: string]: { original: string; modified: string; applyId?: string };
  };
  acceptedApplyIds: string[];
};

export type DocumentsActions = {
  createDocument: (
    name: string,
    text: string,
    opts?: { templateSource?: string }
  ) => void;
  deleteDocument: (name: string) => void;
  saveDocument: (name: string, text: string) => void;
  renameDocument: (oldName: string, newName: string) => void;
  openDocument: (name: string) => void;
  closeDocument: (name: string) => void;
  setActiveTab: (name: string) => void;
  setBuildError: (name: string, buildError?: string) => void;
  setPendingDiff: (
    name: string,
    original: string,
    modified: string,
    applyId?: string
  ) => void;
  clearPendingDiff: (name: string, accepted?: boolean) => void;
};

export type DocumentsStore = DocumentsState & DocumentsActions;

/**
 * The `options.sourceName` to send with generate/preview requests: the
 * document's template provenance when it has one, else its display name.
 * The server only matches sourceName against its own discovered documents,
 * so provenance keeps a renamed copy of a bundled template resolving its
 * relative media/fonts, while the display-name fallback preserves behaviour
 * for documents created before templateSource existed.
 */
export function resolveSourceName(
  documents: TextFile[],
  docName: string
): string {
  return (
    documents.find((doc) => doc.name === docName)?.templateSource ?? docName
  );
}

export const initDocumentsStore = (): DocumentsState => {
  return {
    documents: [],
    openTabs: [],
    activeTab: '',
    buildErrors: {},
    documentTypes: {},
    pendingDiffs: {},
    acceptedApplyIds: [],
  };
};

export const defaultInitDocumentsState: DocumentsState = {
  ...initDocumentsStore(),
};

export const createDocumentsStore = (
  initState: DocumentsState = defaultInitDocumentsState
) => {
  return createStore<DocumentsStore>()(
    devtools(
      persist(
        (set) => ({
          ...initState,
          createDocument: (name, text, opts) =>
            set((state) => {
              const docIndex = state.documents.findIndex(
                (doc) => doc.name === name
              );
              if (docIndex === -1) {
                // if the document does not exist
                // Determine document type based on file name and content
                let docType: DocumentType = 'application/json+report';
                if (isPluginDocumentName(name)) {
                  docType = 'application/typescript+plugin';
                } else if (
                  name.toLowerCase().includes('theme') ||
                  name.toLowerCase().includes('.theme.')
                ) {
                  docType = 'application/json+theme';
                } else {
                  // Try to parse JSON to check if it's a theme
                  try {
                    const parsed = JSON.parse(text);
                    if (parsed.colors && parsed.fonts && parsed.styles) {
                      docType = 'application/json+theme';
                    }
                  } catch {
                    // If not valid JSON, default to report
                  }
                }

                const newDoc = {
                  name,
                  type:
                    docType === 'application/typescript+plugin'
                      ? 'text/typescript'
                      : 'application/json',
                  text,
                  mtime: new Date(),
                  ctime: new Date(),
                  atime: new Date(),
                  // Survives renames: renameDocument spreads the record.
                  ...(opts?.templateSource
                    ? { templateSource: opts.templateSource }
                    : {}),
                };
                return {
                  documents: [...state.documents, newDoc],
                  documentTypes: { ...state.documentTypes, [name]: docType },
                };
              }
              return state;
            }),
          deleteDocument: (name) =>
            set((state) => {
              const newDocumentTypes = { ...state.documentTypes };
              delete newDocumentTypes[name];
              return {
                documents: state.documents.filter((doc) => doc.name !== name),
                documentTypes: newDocumentTypes,
                pendingDiffs: Object.fromEntries(
                  Object.entries(state.pendingDiffs).filter(([k]) => k !== name)
                ),
              };
            }),
          saveDocument: (name, text) =>
            set((state) => {
              const docIndex = state.documents.findIndex(
                (doc) => doc.name === name
              );
              if (docIndex === -1) return state;
              // Skip update if text is unchanged to avoid spurious re-renders
              if (state.documents[docIndex].text === text) return state;
              const documents = state.documents.map((doc, i) =>
                i === docIndex ? { ...doc, text, mtime: new Date() } : doc
              );
              return { documents };
            }),
          renameDocument: (oldName, newName) =>
            set((state) => {
              const docIndex = state.documents.findIndex(
                (doc) => doc.name === oldName
              );
              if (docIndex === -1) return state;
              const documents = state.documents.map((doc, i) =>
                i === docIndex
                  ? { ...doc, name: newName, ctime: new Date() }
                  : doc
              );
              const docType = state.documentTypes[oldName];
              if (docType) {
                const newDocumentTypes = { ...state.documentTypes };
                delete newDocumentTypes[oldName];
                newDocumentTypes[newName] = docType;
                return { documents, documentTypes: newDocumentTypes };
              }
              return { documents };
            }),
          openDocument: (name) =>
            set((state) => {
              const docIndex = state.documents.findIndex(
                (doc) => doc.name === name
              );
              if (docIndex === -1) return state;
              const documents = state.documents.map((doc, i) =>
                i === docIndex ? { ...doc, atime: new Date() } : doc
              );
              let openTabs = state.openTabs;
              if (!openTabs.includes(name)) {
                openTabs =
                  openTabs.length >= MAX_OPEN_TABS
                    ? [...openTabs.slice(1), name]
                    : [...openTabs, name];
              }
              return { documents, openTabs, activeTab: name };
            }),
          closeDocument: (name) =>
            set((state) => {
              const index = state.openTabs.indexOf(name);
              if (index === -1) return state;
              const openTabs = state.openTabs.filter((tab) => tab !== name);
              let activeTab = state.activeTab;
              if (activeTab === name) {
                if (openTabs.length) {
                  activeTab = index === 0 ? openTabs[0] : openTabs[index - 1];
                } else {
                  activeTab = '';
                }
              }
              return { openTabs, activeTab };
            }),
          setActiveTab: (name) => set({ activeTab: name }),
          setBuildError: (name, buildError) =>
            set((state) => {
              if (state.buildErrors[name] === buildError) return state;
              const buildErrors = { ...state.buildErrors };
              if (buildError) buildErrors[name] = buildError;
              else delete buildErrors[name];
              return { buildErrors };
            }),
          setPendingDiff: (name, original, modified, applyId) =>
            set((state) => {
              return {
                pendingDiffs: {
                  ...state.pendingDiffs,
                  [name]: { original, modified, applyId },
                },
              };
            }),
          clearPendingDiff: (name, accepted) =>
            set((state) => {
              const diff = state.pendingDiffs[name];
              if (!diff) return state;
              const next = { ...state.pendingDiffs };
              delete next[name];
              const ids = state.acceptedApplyIds || [];
              const acceptedApplyIds =
                accepted && diff.applyId
                  ? [...ids.slice(-(200 - 1)), diff.applyId]
                  : ids;
              return { pendingDiffs: next, acceptedApplyIds };
            }),
        }),
        {
          name: 'documents-storage',
          version: 1,
          storage: createJSONStorage(() => idbStorage),
          partialize: (state) => ({
            documents: state.documents,
            openTabs: state.openTabs,
            activeTab: state.activeTab,
            documentTypes: state.documentTypes,
            // buildErrors + pendingDiffs + acceptedApplyIds excluded — transient UI state
          }),
          onRehydrateStorage: () => (state) => {
            if (state?.documents) {
              for (const doc of state.documents) {
                for (const key of ['mtime', 'ctime', 'atime'] as const) {
                  if (doc[key] && typeof doc[key] === 'string') {
                    (doc as Record<string, unknown>)[key] = new Date(
                      doc[key] as unknown as string
                    );
                  }
                }
              }
            }
          },
        }
      )
    )
  );
};
