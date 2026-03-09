import { type ReactNode, createContext, useContext } from 'react';
import { useChatSession } from '../hooks/useChatSession';

type ChatSessionValue = ReturnType<typeof useChatSession>;

const ChatSessionContext = createContext<ChatSessionValue | null>(null);

export function ChatSessionProvider({ children }: { children: ReactNode }) {
  const session = useChatSession();
  return (
    <ChatSessionContext.Provider value={session}>
      {children}
    </ChatSessionContext.Provider>
  );
}

export function useChatSessionContext(): ChatSessionValue {
  const ctx = useContext(ChatSessionContext);
  if (!ctx) {
    throw new Error('useChatSessionContext must be used within ChatSessionProvider');
  }
  return ctx;
}
