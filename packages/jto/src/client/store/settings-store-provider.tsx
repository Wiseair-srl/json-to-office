import { type ReactNode, createContext, useRef, useContext } from 'react';
import { useStore } from 'zustand';
import {
  type SettingsStore,
  createSettingsStore,
  initSettingsStore,
} from './settings-store';

export type SettingsStoreApi = ReturnType<typeof createSettingsStore>;

export const SettingsStoreContext = createContext<SettingsStoreApi | undefined>(
  undefined
);

export interface SettingsStoreProviderProps {
  children: ReactNode;
}

export const SettingsStoreProvider = ({
  children,
}: SettingsStoreProviderProps) => {
  const storeRef = useRef<SettingsStoreApi | null>(null);
  if (!storeRef.current) {
    storeRef.current = createSettingsStore(initSettingsStore());
  }

  return (
    <SettingsStoreContext.Provider value={storeRef.current}>
      {children}
    </SettingsStoreContext.Provider>
  );
};

export const useSettingsStore = <T,>(
  selector: (store: SettingsStore) => T
): T => {
  const settingsStoreContext = useContext(SettingsStoreContext);

  if (!settingsStoreContext) {
    throw new Error(
      'useSettingsStore must be used within SettingsStoreProvider'
    );
  }

  return useStore(settingsStoreContext, selector);
};
