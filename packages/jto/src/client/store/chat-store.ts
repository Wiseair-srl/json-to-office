import { devtools, persist, createJSONStorage } from 'zustand/middleware';
import { createStore } from 'zustand/vanilla';
import { idbStorage } from '../lib/idb-storage';
import type { SelectionContext } from '../lib/monaco-selection-utils';

export type ChatThread = {
  id: string;
  documentName: string;
  title: string;
  messages: any[];
  createdAt: number;
  updatedAt: number;
};

export function defaultThreadTitle(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `Chat ${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export type ChatState = {
  chatOpen: boolean;
  contextAttachments: (SelectionContext & { documentName?: string })[];
  threads: Record<string, ChatThread>;
  activeThreadId: Record<string, string>; // documentName → thread id
};

export type ChatActions = {
  toggleChat: () => void;
  openChat: () => void;
  closeChat: () => void;
  addContext: (ctx: SelectionContext & { documentName?: string }) => void;
  removeContext: (index: number) => void;
  clearContext: () => void;
  createThread: (docName: string) => string;
  deleteThread: (id: string) => void;
  switchThread: (id: string) => void;
  updateThreadMessages: (id: string, msgs: any[]) => void;
  updateThreadTitle: (id: string, title: string) => void;
  deleteThreadsForDocument: (docName: string) => void;
  renameThreadsForDocument: (oldName: string, newName: string) => void;
  clearChat: () => void;
};

export type ChatStore = ChatState & ChatActions;

export const initChatStore = (): ChatState => ({
  chatOpen: false,
  contextAttachments: [],
  threads: {},
  activeThreadId: {},
});

export const createChatStore = (
  initState: ChatState = initChatStore()
) => {
  return createStore<ChatStore>()(
    devtools(
      persist(
        (set, get) => ({
          ...initState,
          toggleChat: () => set((s) => ({ chatOpen: !s.chatOpen })),
          openChat: () => set({ chatOpen: true }),
          closeChat: () => set({ chatOpen: false }),
          addContext: (ctx) =>
            set((s) => ({
              contextAttachments: [...s.contextAttachments, ctx],
            })),
          removeContext: (index) =>
            set((s) => ({
              contextAttachments: s.contextAttachments.filter(
                (_, i) => i !== index
              ),
            })),
          clearContext: () => set({ contextAttachments: [] }),

          createThread: (docName: string) => {
            const id = crypto.randomUUID();
            const now = Date.now();
            const thread: ChatThread = {
              id,
              documentName: docName,
              title: defaultThreadTitle(),
              messages: [],
              createdAt: now,
              updatedAt: now,
            };
            set((s) => ({
              threads: { ...s.threads, [id]: thread },
              activeThreadId: { ...s.activeThreadId, [docName]: id },
            }));
            return id;
          },

          deleteThread: (id: string) => {
            const s = get();
            const thread = s.threads[id];
            if (!thread) return;
            const rest = Object.fromEntries(
              Object.entries(s.threads).filter(([k]) => k !== id)
            ) as typeof s.threads;
            const docName = thread.documentName;
            // If this was the active thread, switch to another
            const newActiveThreadId = { ...s.activeThreadId };
            if (newActiveThreadId[docName] === id) {
              const remaining = Object.values(rest).filter(
                (t) => t.documentName === docName
              );
              if (remaining.length > 0) {
                remaining.sort((a, b) => b.updatedAt - a.updatedAt);
                newActiveThreadId[docName] = remaining[0].id;
              } else {
                delete newActiveThreadId[docName];
              }
            }
            set({ threads: rest, activeThreadId: newActiveThreadId });
          },

          switchThread: (id: string) => {
            const s = get();
            const thread = s.threads[id];
            if (!thread) return;
            set((s) => ({
              activeThreadId: {
                ...s.activeThreadId,
                [thread.documentName]: id,
              },
            }));
          },

          updateThreadMessages: (id: string, msgs: any[]) => {
            set((s) => {
              const thread = s.threads[id];
              if (!thread) return s;
              return {
                threads: {
                  ...s.threads,
                  [id]: { ...thread, messages: msgs, updatedAt: Date.now() },
                },
              };
            });
          },

          updateThreadTitle: (id: string, title: string) => {
            set((s) => {
              const thread = s.threads[id];
              if (!thread) return s;
              return {
                threads: {
                  ...s.threads,
                  [id]: { ...thread, title },
                },
              };
            });
          },

          deleteThreadsForDocument: (docName: string) => {
            set((s) => {
              const threads = { ...s.threads };
              const activeThreadId = { ...s.activeThreadId };
              for (const [id, thread] of Object.entries(threads)) {
                if (thread.documentName === docName) {
                  delete threads[id];
                }
              }
              delete activeThreadId[docName];
              return { threads, activeThreadId };
            });
          },

          renameThreadsForDocument: (oldName: string, newName: string) => {
            set((s) => {
              const threads = { ...s.threads };
              const activeThreadId = { ...s.activeThreadId };
              for (const [id, thread] of Object.entries(threads)) {
                if (thread.documentName === oldName) {
                  threads[id] = { ...thread, documentName: newName };
                }
              }
              if (oldName in activeThreadId) {
                activeThreadId[newName] = activeThreadId[oldName];
                delete activeThreadId[oldName];
              }
              return { threads, activeThreadId };
            });
          },

          clearChat: () => {
            // Clear active thread's messages (not the thread itself)
            set((_s) => {
              // Find any active thread by looking at all active thread ids
              // This is called from UI context where we don't know the doc name,
              // so we clear contextAttachments and let ChatPanel handle thread clearing
              return {
                contextAttachments: [],
              };
            });
          },
        }),
        {
          name: 'chat-storage',
          version: 1,
          storage: createJSONStorage(() => idbStorage),
          partialize: (state) => ({
            threads: state.threads,
            activeThreadId: state.activeThreadId,
          }),
          migrate: (persisted: any, version: number) => {
            if (version === 0 && persisted) {
              // v0 had chatMessages: any[]. Convert to single thread.
              const oldMessages = persisted.chatMessages;
              if (Array.isArray(oldMessages) && oldMessages.length > 0) {
                const id = crypto.randomUUID();
                const now = Date.now();
                return {
                  threads: {
                    [id]: {
                      id,
                      documentName: '__migrated__',
                      title: 'Migrated Chat',
                      messages: oldMessages,
                      createdAt: now,
                      updatedAt: now,
                    } as ChatThread,
                  },
                  activeThreadId: { __migrated__: id },
                };
              }
              return { threads: {}, activeThreadId: {} };
            }
            return persisted as any;
          },
        }
      )
    )
  );
};
