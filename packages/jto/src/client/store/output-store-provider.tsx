import { type ReactNode, createContext, useRef, useContext } from 'react';
import { useStore } from 'zustand';
import {
  type OutputStore,
  createOutputStore,
  initOutputStore,
} from './output-store';

export type OutputStoreApi = ReturnType<typeof createOutputStore>;

export const OutputStoreContext = createContext<OutputStoreApi | undefined>(
  undefined
);

export interface OutputStoreProviderProps {
  children: ReactNode;
}

export const OutputStoreProvider = ({ children }: OutputStoreProviderProps) => {
  const storeRef = useRef<OutputStoreApi | null>(null);
  if (!storeRef.current) {
    storeRef.current = createOutputStore(initOutputStore());
  }

  return (
    <OutputStoreContext.Provider value={storeRef.current}>
      {children}
    </OutputStoreContext.Provider>
  );
};

export const useOutputStore = <T,>(selector: (store: OutputStore) => T): T => {
  const outputStoreContext = useContext(OutputStoreContext);

  if (!outputStoreContext) {
    throw new Error(`useOutputStore must be used within OutputStoreProvider`);
  }

  return useStore(outputStoreContext, selector);
};
