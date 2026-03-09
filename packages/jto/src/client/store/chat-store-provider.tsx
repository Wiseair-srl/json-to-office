import { type ReactNode, createContext, useRef, useContext } from 'react';
import { useStore } from 'zustand';
import {
  type ChatStore,
  createChatStore,
  initChatStore,
} from './chat-store';

export type ChatStoreApi = ReturnType<typeof createChatStore>;

export const ChatStoreContext = createContext<ChatStoreApi | undefined>(
  undefined
);

export interface ChatStoreProviderProps {
  children: ReactNode;
}

export const ChatStoreProvider = ({ children }: ChatStoreProviderProps) => {
  const storeRef = useRef<ChatStoreApi | null>(null);
  if (!storeRef.current) {
    storeRef.current = createChatStore(initChatStore());
  }

  return (
    <ChatStoreContext.Provider value={storeRef.current}>
      {children}
    </ChatStoreContext.Provider>
  );
};

export const useChatStore = <T,>(
  selector: (store: ChatStore) => T
): T => {
  const chatStoreContext = useContext(ChatStoreContext);

  if (!chatStoreContext) {
    throw new Error('useChatStore must be used within ChatStoreProvider');
  }

  return useStore(chatStoreContext, selector);
};
