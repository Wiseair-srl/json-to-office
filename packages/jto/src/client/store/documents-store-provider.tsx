import { type ReactNode, createContext, useRef, useContext } from 'react';
import { useStore } from 'zustand';
import {
  type DocumentsStore,
  createDocumentsStore,
  initDocumentsStore,
} from './documents-store';

export type DocumentsStoreApi = ReturnType<typeof createDocumentsStore>;

export const DocumentsStoreContext = createContext<
  DocumentsStoreApi | undefined
>(undefined);

export interface DocumentsStoreProviderProps {
  children: ReactNode;
}

export const DocumentsStoreProvider = ({
  children,
}: DocumentsStoreProviderProps) => {
  const storeRef = useRef<DocumentsStoreApi | null>(null);
  if (!storeRef.current) {
    storeRef.current = createDocumentsStore(initDocumentsStore());
  }

  return (
    <DocumentsStoreContext.Provider value={storeRef.current}>
      {children}
    </DocumentsStoreContext.Provider>
  );
};

export const useDocumentsStore = <T,>(
  selector: (store: DocumentsStore) => T
): T => {
  const documentsStoreContext = useContext(DocumentsStoreContext);

  if (!documentsStoreContext) {
    throw new Error(
      `useDocumentsStore must be used within DocumentsStoreProvider`
    );
  }

  return useStore(documentsStoreContext, selector);
};
