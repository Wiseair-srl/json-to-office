import { type ReactNode, createContext, useRef, useContext } from 'react';
import { useStore } from 'zustand';

import {
  type ThemesStore,
  createThemesStore,
  initThemesStore,
} from './themes-store';

export type ThemesStoreApi = ReturnType<typeof createThemesStore>;

export const ThemesStoreContext = createContext<ThemesStoreApi | undefined>(
  undefined
);

export interface ThemesStoreProviderProps {
  children: ReactNode;
}

export const ThemesStoreProvider = ({ children }: ThemesStoreProviderProps) => {
  const storeRef = useRef<ThemesStoreApi>(undefined);
  if (!storeRef.current) {
    storeRef.current = createThemesStore(initThemesStore());
  }

  return (
    <ThemesStoreContext.Provider value={storeRef.current}>
      {children}
    </ThemesStoreContext.Provider>
  );
};

export const useThemesStore = <T,>(selector: (store: ThemesStore) => T): T => {
  const themesStoreContext = useContext(ThemesStoreContext);

  if (!themesStoreContext) {
    throw new Error('useThemesStore must be used within ThemesStoreProvider');
  }

  return useStore(themesStoreContext, selector);
};
