/**
 * Editor References Store
 * Manages references to Monaco editor instances for selection context
 */

import { create } from 'zustand';
import type { editor as MonacoEditorType } from 'monaco-editor';
import type { Monaco } from '@monaco-editor/react';
import type { CollapseController } from '../lib/monaco-collapse-strings';

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
  /**
   * Long-string collapse controller for this editor, when installed. Consumers
   * that apply edits which MOVE model text (e.g. the outline drag-reorder)
   * must call `collapse.resyncDecorations()` afterwards so chips re-anchor.
   */
  collapse?: CollapseController;
  /**
   * Commit any keystrokes still sitting in the save debounce.
   *
   * Anything that WRITES the document back to the store must call this first,
   * or the trailing save fires afterwards holding pre-write text and silently
   * reverts the write.
   */
  flushPendingSave?: () => void;
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
    toStorageValue?: (modelText: string) => string,
    collapse?: CollapseController,
    flushPendingSave?: () => void
  ) => void;
  unregisterEditor: (documentName: string) => void;
  setActiveEditor: (documentName: string | null) => void;
  getActiveEditor: () => EditorReference | null;
  getEditor: (documentName: string) => EditorReference | null;
  /** The editor showing this model — how a language feature finds its document. */
  getEditorForModel: (
    model: MonacoEditorType.ITextModel
  ) => EditorReference | null;
}

export type EditorRefsStore = EditorRefsState & EditorRefsActions;

export const useEditorRefsStore = create<EditorRefsStore>((set, get) => ({
  editors: new Map(),
  activeEditorName: null,

  registerEditor: (
    documentName,
    editor,
    monaco,
    toStorageValue,
    collapse,
    flushPendingSave
  ) => {
    set((state) => {
      const newEditors = new Map(state.editors);
      newEditors.set(documentName, {
        editor,
        monaco,
        documentName,
        toStorageValue: toStorageValue ?? ((text) => text),
        collapse,
        flushPendingSave,
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

  getEditorForModel: (model) => {
    for (const entry of get().editors.values())
      if (entry.editor.getModel() === model) return entry;
    return null;
  },
}));
