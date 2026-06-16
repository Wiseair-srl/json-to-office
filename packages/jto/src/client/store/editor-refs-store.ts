/**
 * Editor References Store
 * Manages references to Monaco editor instances for selection context
 */

import { create } from 'zustand';
import type { editor as MonacoEditorType } from 'monaco-editor';
import type { Monaco } from '@monaco-editor/react';

export interface EditorReference {
  editor: MonacoEditorType.IStandaloneCodeEditor;
  monaco: Monaco;
  documentName: string;
  /**
   * Reconstruct the full document text from the live model text, expanding any
   * collapsed long-string sentinels (`§jtoc:<id>§`) back to their real values.
   * Any consumer that reads `editor.getValue()` for persistence or rendering
   * MUST pipe it through this, or sentinels leak into the output.
   */
  toStorageValue: (modelText: string) => string;
}

interface EditorRefsState {
  editors: Map<string, EditorReference>;
  activeEditorName: string | null;
}

interface EditorRefsActions {
  registerEditor: (
    documentName: string,
    editor: MonacoEditorType.IStandaloneCodeEditor,
    monaco: Monaco,
    toStorageValue?: (modelText: string) => string
  ) => void;
  unregisterEditor: (documentName: string) => void;
  setActiveEditor: (documentName: string | null) => void;
  getActiveEditor: () => EditorReference | null;
  getEditor: (documentName: string) => EditorReference | null;
}

export type EditorRefsStore = EditorRefsState & EditorRefsActions;

export const useEditorRefsStore = create<EditorRefsStore>((set, get) => ({
  editors: new Map(),
  activeEditorName: null,

  registerEditor: (documentName, editor, monaco, toStorageValue) => {
    set((state) => {
      const newEditors = new Map(state.editors);
      newEditors.set(documentName, {
        editor,
        monaco,
        documentName,
        toStorageValue: toStorageValue ?? ((text) => text),
      });
      return { editors: newEditors };
    });
  },

  unregisterEditor: (documentName) => {
    set((state) => {
      const newEditors = new Map(state.editors);
      newEditors.delete(documentName);
      return {
        editors: newEditors,
        activeEditorName:
          state.activeEditorName === documentName
            ? null
            : state.activeEditorName,
      };
    });
  },

  setActiveEditor: (documentName) => {
    set({ activeEditorName: documentName });
  },

  getActiveEditor: () => {
    const state = get();
    if (!state.activeEditorName) return null;
    return state.editors.get(state.activeEditorName) || null;
  },

  getEditor: (documentName) => {
    return get().editors.get(documentName) || null;
  },
}));
