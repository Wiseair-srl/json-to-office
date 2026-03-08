import { devtools, persist } from 'zustand/middleware';
import { createStore } from 'zustand/vanilla';
import type { Settings } from '../lib/types';
import { FORMAT } from '../lib/env';

export type SettingsState = Settings;

export type SettingsActions = {
  setSettings: (settings: Settings) => void;
};

export type SettingsStore = SettingsState & SettingsActions;

export const initSettingsStore = (): SettingsState => {
  return {
    saveDocumentDebounceWait: 300,
    autoReload: true,
    renderingLibrary: FORMAT === 'docx' ? 'docxjs' : 'LibreOffice',
    // UI preference to use a single preview header spanning editor + preview
    useGlobalPreviewHeader: true,
  };
};

export const defaultInitSettingsState: SettingsState = {
  ...initSettingsStore(),
};

export const createSettingsStore = (
  initState: SettingsState = defaultInitSettingsState
) => {
  return createStore<SettingsStore>()(
    devtools(
      persist(
        (set) => ({
          ...initState,
          setSettings: (settings) => set({ ...settings }),
        }),
        {
          name: 'settings-storage', // name of the item in the storage (must be unique)
          // (optional) by default, 'localStorage' is used as storage
        }
      )
    )
  );
};
