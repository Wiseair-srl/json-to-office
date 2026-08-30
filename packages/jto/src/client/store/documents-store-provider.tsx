import {
  type ReactNode,
  createContext,
  useCallback,
  useRef,
  useContext,
} from 'react';
import { useStore } from 'zustand';
import {
  type DocumentsStore,
  createDocumentsStore,
  initDocumentsStore,
  resolveSourceName,
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
      'useDocumentsStore must be used within DocumentsStoreProvider'
    );
  }

  return useStore(documentsStoreContext, selector);
};

/**
 * Stable `docName -> options.sourceName` resolver for generate/preview
 * requests. Reads the store imperatively at call time — no subscription, so
 * callbacks holding it don't re-create on every document edit.
 */
export const useResolveSourceName = (): ((docName: string) => string) => {
  const documentsStoreContext = useContext(DocumentsStoreContext);

  if (!documentsStoreContext) {
    throw new Error(
      'useResolveSourceName must be used within DocumentsStoreProvider'
    );
  }

  return useCallback(
    (docName: string) =>
      resolveSourceName(documentsStoreContext.getState().documents, docName),
    [documentsStoreContext]
  );
};
