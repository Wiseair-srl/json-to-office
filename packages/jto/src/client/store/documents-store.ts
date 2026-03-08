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
                state.documents.push(newDoc);
                state.documentTypes[name] = docType;
              }
              return {
                documents: [...state.documents],
                documentTypes: { ...state.documentTypes },
              };
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
              if (docIndex !== -1) {
                // if the document exists
                const doc = state.documents[docIndex];
                doc.text = text;
                doc.mtime = new Date();
                state.documents[docIndex] = { ...doc }; // update the document
              }
              return { documents: [...state.documents] };
            }),
          renameDocument: (oldName, newName) =>
            set((state) => {
              const docIndex = state.documents.findIndex(
                (doc) => doc.name === oldName
              );
              if (docIndex !== -1) {
                // if the document exists
                const doc = state.documents[docIndex];
                doc.name = newName;
                doc.ctime = new Date();
                state.documents[docIndex] = { ...doc }; // update the document

                // Update document type mapping
                const docType = state.documentTypes[oldName];
                if (docType) {
                  const newDocumentTypes = { ...state.documentTypes };
                  delete newDocumentTypes[oldName];
                  newDocumentTypes[newName] = docType;
                  return {
                    documents: [...state.documents],
                    documentTypes: newDocumentTypes,
                  };
                }
              }
              return { documents: [...state.documents] };
            }),
          openDocument: (name) =>
            set((state) => {
              const docIndex = state.documents.findIndex(
                (doc) => doc.name === name
              );
              if (docIndex !== -1) {
                // if the document exists
                const doc = state.documents[docIndex];
                doc.atime = new Date();
                state.documents[docIndex] = { ...doc }; // update the document
                state.documents = [...state.documents]; // update the documents
                // if not already open tab
                if (!state.openTabs.includes(name)) {
                  // remove the first tab if the max number of tabs is reached
                  if (state.openTabs.length >= MAX_OPEN_TABS) {
                    state.openTabs.shift();
                  }
                  state.openTabs.push(name); // add the new tab
                  state.openTabs = [...state.openTabs]; // update the openTabs
                }
                // activate the tab
                state.activeTab = name;
              }
              return {
                documents: state.documents,
                openTabs: state.openTabs,
                activeTab: state.activeTab,
              };
            }),
          closeDocument: (name) =>
            set((state) => {
              const index = state.openTabs.indexOf(name);
              if (index !== -1) {
                // if the tab is open
                state.openTabs = state.openTabs.filter((tab) => tab !== name);
                // check if the active tab is the one being closed
                if (state.activeTab === name) {
                  if (state.openTabs.length) {
                    // if there are still tabs open
                    if (index === 0) {
                      // if first tab, set the active tab to the next one
                      state.activeTab = state.openTabs[index];
                    } else {
                      // if not the first tab, set the active tab to the previous one
                      state.activeTab = state.openTabs[index - 1];
                    }
                  } else {
                    state.activeTab = ``;
                  }
                }
              }
              return {
                openTabs: state.openTabs,
                activeTab: state.activeTab,
              };
            }),
          setActiveTab: (name) => set({ activeTab: name }),
          setBuildError: (name, buildError) =>
            set((state) => {
              if (state.buildErrors[name] === buildError) return state; // no change
              if (buildError) state.buildErrors[name] = buildError;
              else delete state.buildErrors[name];
              return { buildErrors: { ...state.buildErrors } };
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
