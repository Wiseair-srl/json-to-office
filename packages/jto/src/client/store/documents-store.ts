import { persist, devtools } from 'zustand/middleware';
import { createStore } from 'zustand/vanilla';
import type { TextFile } from '../lib/types';

const MAX_OPEN_TABS = 3;

export type DocumentType = 'application/json+report' | 'application/json+theme';

export type DocumentsState = {
  documents: TextFile[];
  openTabs: string[];
  activeTab: string;
  buildErrors: { [key: string]: string };
  documentTypes: { [key: string]: DocumentType };
  pendingDiffs: { [key: string]: { original: string; modified: string } };
};

export type DocumentsActions = {
  createDocument: (name: string, text: string) => void;
  deleteDocument: (name: string) => void;
  saveDocument: (name: string, text: string) => void;
  renameDocument: (oldName: string, newName: string) => void;
  openDocument: (name: string) => void;
  closeDocument: (name: string) => void;
  setActiveTab: (name: string) => void;
  setBuildError: (name: string, buildError?: string) => void;
  setPendingDiff: (name: string, original: string, modified: string) => void;
  clearPendingDiff: (name: string) => void;
};

export type DocumentsStore = DocumentsState & DocumentsActions;

export const initDocumentsStore = (): DocumentsState => {
  return {
    documents: [],
    openTabs: [],
    activeTab: ``,
    buildErrors: {},
    documentTypes: {},
    pendingDiffs: {},
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
          createDocument: (name, text) =>
            set((state) => {
              const docIndex = state.documents.findIndex(
                (doc) => doc.name === name
              );
              if (docIndex === -1) {
                // if the document does not exist
                // Determine document type based on file name and content
                let docType: DocumentType = 'application/json+report';
                if (
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
                  type: 'application/json',
                  text,
                  mtime: new Date(),
                  ctime: new Date(),
                  atime: new Date(),
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
                i === docIndex ? { ...doc, name: newName, ctime: new Date() } : doc
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
                openTabs = openTabs.length >= MAX_OPEN_TABS
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
          setPendingDiff: (name, original, modified) =>
            set((state) => {
              return {
                pendingDiffs: {
                  ...state.pendingDiffs,
                  [name]: { original, modified },
                },
              };
            }),
          clearPendingDiff: (name) =>
            set((state) => {
              if (!state.pendingDiffs[name]) return state;
              const next = { ...state.pendingDiffs };
              delete next[name];
              return { pendingDiffs: next };
            }),
        }),
        {
          name: 'documents-storage', // name of the item in the storage (must be unique)
          // (optional) by default, 'localStorage' is used as storage
        }
      )
    )
  );
};
