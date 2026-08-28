import { devtools, persist } from 'zustand/middleware';
import { createStore } from 'zustand/vanilla';
import type { Settings } from '../lib/types';

export type SettingsState = Settings;

export type SettingsActions = {
  setSettings: (settings: Partial<Settings>) => void;
};

export type SettingsStore = SettingsState & SettingsActions;

export const initSettingsStore = (): SettingsState => {
  return {
    saveDocumentDebounceWait: 300,
    // UI preference to use a single preview header spanning editor + preview
    useGlobalPreviewHeader: true,
    // Report, never block: a gate is something an author opts into once they
    // know what the profile flags, not a default that refuses their first
    // build.
    qualityGate: 'none',
    // Warning-and-above, deliberately. The shipped PPTX templates produce
    // roughly two hundred info-severity findings, so an info default would
    // bury the panel in noise the first time it is opened and teach authors
    // to ignore it.
    qualityMinSeverity: 'warning',
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
