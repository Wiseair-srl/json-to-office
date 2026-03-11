import { useEffect, useRef, useCallback, useState, useMemo, memo } from 'react';
import { Send, X, Loader2, Square } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '../../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '../../ui/dialog';
import { useChatStore } from '../../../store/chat-store-provider';
import { useDocumentsStore } from '../../../store/documents-store-provider';
import { useChatSessionContext } from '../../../store/chat-session-provider';
import { ChatContextChip } from './chat-context-chip';
import { ChatApplyButton } from './chat-apply-button';
import { ChatThreadList } from './chat-thread-list';
import { ScrollArea } from '../../ui/scroll-area';
import { KbdShortcut } from '../../ui/kbd';
import { defaultThreadTitle } from '../../../store/chat-store';

export function ChatPanel() {
  const contextAttachments = useChatStore((s) => s.contextAttachments);
  const addContext = useChatStore((s) => s.addContext);
  const removeContext = useChatStore((s) => s.removeContext);
  const openChat = useChatStore((s) => s.openChat);
  const closeChat = useChatStore((s) => s.closeChat);

  const threads = useChatStore((s) => s.threads);
  const activeThreadIdMap = useChatStore((s) => s.activeThreadId);
  const createThread = useChatStore((s) => s.createThread);
  const deleteThread = useChatStore((s) => s.deleteThread);
  const switchThread = useChatStore((s) => s.switchThread);
  const updateThreadMessages = useChatStore((s) => s.updateThreadMessages);
  const updateThreadTitle = useChatStore((s) => s.updateThreadTitle);
  const deleteThreadsForDocument = useChatStore((s) => s.deleteThreadsForDocument);

  const activeTab = useDocumentsStore((s) => s.activeTab);
  const documents = useDocumentsStore((s) => s.documents);

  const { messages, sendMessage, status, setMessages, stop, getMessageContext } = useChatSessionContext();

  const [input, setInput] = useState('');
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Derive active thread and threads for current doc
  const activeThreadId = activeTab ? activeThreadIdMap[activeTab] : undefined;
  const activeThread = activeThreadId ? threads[activeThreadId] : undefined;

  const threadsForDoc = useMemo(() => {
    if (!activeTab) return [];
    return Object.values(threads)
      .filter((t) => t.documentName === activeTab)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [threads, activeTab]);

  // Auto-create thread when doc has none
  useEffect(() => {
    if (activeTab && threadsForDoc.length === 0) {
      createThread(activeTab);
    }
  }, [activeTab, threadsForDoc.length, createThread]);

  // Orphan cleanup: delete threads for docs that no longer exist
  useEffect(() => {
    const docNames = new Set(documents.map((d) => d.name));
    const orphanDocs = new Set<string>();
    for (const thread of Object.values(threads)) {
      if (!docNames.has(thread.documentName) && thread.documentName !== '__migrated__') {
        orphanDocs.add(thread.documentName);
      }
    }
    for (const docName of orphanDocs) {
      deleteThreadsForDocument(docName);
    }
  }, [documents, threads, deleteThreadsForDocument]);

  // Swap messages when active thread changes (null sentinel ensures first mount always syncs)
  const prevThreadIdRef = useRef<string | undefined | null>(null);
  useEffect(() => {
    if (prevThreadIdRef.current !== activeThreadId) {
      prevThreadIdRef.current = activeThreadId;
      setMessages(activeThread?.messages ?? []);
    }
  }, [activeThreadId, activeThread, setMessages]);

  // Auto-scroll to bottom via sentinel div
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, status]);

  // Listen for monaco selection events
  useEffect(() => {
    const handler = (e: CustomEvent) => {
      const { documentName, selection } = e.detail;
      addContext({ ...selection, documentName });
      openChat();
      inputRef.current?.focus();
    };
    window.addEventListener(
      'monaco-selection-to-ai',
      handler as EventListener
    );
    return () =>
      window.removeEventListener(
        'monaco-selection-to-ai',
        handler as EventListener
      );
  }, [addContext, openChat]);

  const isStreaming = status === 'streaming';
  const isLoading = status === 'submitted' || isStreaming;

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!input.trim() || isLoading) return;
      sendMessage(input);
      setInput('');
    },
    [input, isLoading, sendMessage]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit(e);
      }
    },
    [handleSubmit]
  );

  const requestClearChat = useCallback(() => {
    if (messages.length === 0) return;
    setConfirmClearOpen(true);
  }, [messages.length]);

  const confirmClearChat = useCallback(() => {
    setConfirmClearOpen(false);
    setMessages([]);
    if (activeThreadId) {
      updateThreadMessages(activeThreadId, []);
      updateThreadTitle(activeThreadId, defaultThreadTitle());
    }
  }, [setMessages, activeThreadId, updateThreadMessages, updateThreadTitle]);

  const handleDeleteThread = useCallback(
    (id: string) => {
      if (isLoading) return;
      if (threadsForDoc.length <= 1) {
        requestClearChat();
        return;
      }
      deleteThread(id);
    },
    [isLoading, threadsForDoc.length, requestClearChat, deleteThread]
  );

  const handleCreateThread = useCallback((): string | undefined => {
    if (!activeTab || isLoading) return undefined;
    return createThread(activeTab);
  }, [activeTab, isLoading, createThread]);

  const handleSwitchThread = useCallback(
    (id: string) => {
      if (isLoading || id === activeThreadId) return;
      switchThread(id);
    },
    [isLoading, activeThreadId, switchThread]
  );

  const handleRenameThread = useCallback(
    (id: string, title: string) => {
      updateThreadTitle(id, title);
    },
    [updateThreadTitle]
  );

  return (
    <div className="flex flex-col h-full border-l bg-surface-chat">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/60 bg-surface-chat">
        <ChatThreadList
          threads={threadsForDoc}
          activeThread={activeThread}
          disabled={isLoading}
          onSwitch={handleSwitchThread}
          onCreate={handleCreateThread}
          onDelete={handleDeleteThread}
          onRename={handleRenameThread}
        />
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
            onClick={requestClearChat}
            disabled={isLoading || messages.length === 0}
          >
            Clear
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={closeChat}
            title="Close chat"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 min-h-0 [&_[data-radix-scroll-area-viewport]>div]:!block">
        <div className="p-3 space-y-4 min-w-0">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 px-4">
              <div className="rounded-xl bg-primary/10 p-3 mb-4">
                <Send className="h-5 w-5 text-primary" />
              </div>
              <p className="text-sm font-medium text-foreground/80 mb-1">
                JSON Assistant
              </p>
              <p className="text-xs text-muted-foreground text-center max-w-[200px] mb-4">
                Generate, edit, and refine your JSON document definitions with AI.
              </p>
              <div className="flex items-center gap-1.5 rounded-md bg-muted/50 px-2.5 py-1.5">
                <KbdShortcut shortcut="mod+k" />
                <span className="text-xs text-muted-foreground">
                  to send a selection
                </span>
              </div>
            </div>
          )}
          {messages.map((msg, i) => {
            // For assistant messages, find the preceding user message's context
            let msgContext: ReturnType<typeof getMessageContext> | undefined;
            if (msg.role === 'assistant') {
              for (let j = i - 1; j >= 0; j--) {
                if (messages[j].role === 'user') {
                  msgContext = getMessageContext(messages[j].id);
                  break;
                }
              }
            }

            const isMsgStreaming = isStreaming && i === messages.length - 1 && msg.role === 'assistant';

            return (
              <ChatMessage
                key={msg.id}
                msg={msg}
                isStreaming={isMsgStreaming}
                context={msgContext}
              />
            );
          })}
          {/* Loading indicator: covers both submitted (waiting) and streaming states */}
          {isLoading && messages[messages.length - 1]?.role !== 'assistant' && (
            <div className="flex justify-start">
              <div className="rounded-lg px-3 py-2 bg-muted/60 border border-border/40">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                  <span>Thinking...</span>
                </div>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Context chips + input */}
      <div className="border-t border-border/60 p-2.5 space-y-2 bg-surface-chat">
        {contextAttachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {contextAttachments.map((ctx, i) => (
              <ChatContextChip
                key={i}
                context={ctx}
                onRemove={() => removeContext(i)}
              />
            ))}
          </div>
        )}
        <form onSubmit={handleSubmit} className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              const el = e.target;
              el.style.height = 'auto';
              el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
            }}
            onKeyDown={handleKeyDown}
            placeholder={
              contextAttachments.length > 0
                ? 'Describe how to edit the selection...'
                : 'Ask AI to generate or edit JSON...'
            }
            className="flex-1 min-h-[36px] max-h-32 resize-none overflow-y-auto rounded-lg border border-border/60 bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground placeholder:whitespace-nowrap placeholder:overflow-hidden placeholder:text-ellipsis focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:border-primary/50 transition-shadow"
            rows={1}
          />
          {isLoading ? (
            <Button
              type="button"
              size="icon"
              variant="destructive"
              className="shrink-0 h-9 w-9 rounded-lg"
              onClick={stop}
              title="Stop generating"
            >
              <Square className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon"
              disabled={!input.trim()}
              className="shrink-0 h-9 w-9 rounded-lg"
            >
              <Send className="h-4 w-4" />
            </Button>
          )}
        </form>
      </div>
      <Dialog open={confirmClearOpen} onOpenChange={setConfirmClearOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Clear thread</DialogTitle>
            <DialogDescription>
              This will delete all messages in this thread. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" size="sm">Cancel</Button>
            </DialogClose>
            <Button variant="destructive" size="sm" onClick={confirmClearChat}>
              Clear
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Fix 1: Memoized wrapper — completed messages skip re-render during streaming */
const ChatMessage = memo(function ChatMessage({
  msg,
  isStreaming,
  context,
}: {
  msg: any;
  isStreaming: boolean;
  context?: any[];
}) {
  const text = msg.parts
    ?.filter((p: any) => p.type === 'text')
    .map((p: any) => p.text)
    .join('') || '';

  return (
    <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`rounded-lg px-3 py-2 max-w-[90%] overflow-hidden min-w-0 ${
          msg.role === 'user'
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted/60 border border-border/40'
        }`}
      >
        {msg.role === 'user' ? (
          <div className="whitespace-pre-wrap text-sm break-words">{text}</div>
        ) : (
          <AssistantMessage text={text} isStreaming={isStreaming} context={context} />
        )}
      </div>
    </div>
  );
}, (prev, next) => prev.msg.id === next.msg.id && prev.isStreaming === next.isStreaming);

/** Fix 2: Skip Markdown parsing during streaming — render plain text instead */
function AssistantMessage({ text, isStreaming, context }: { text: string; isStreaming: boolean; context?: any[] }) {
  // During streaming, skip expensive Markdown + remarkGfm parsing
  if (isStreaming) {
    return (
      <div className="text-sm prose prose-sm dark:prose-invert break-words [&_pre]:overflow-x-auto [&_p]:my-1">
        <pre className="whitespace-pre-wrap font-sans text-sm m-0 p-0 bg-transparent border-none">{text}</pre>
      </div>
    );
  }

  return (
    <div className="text-sm prose prose-sm dark:prose-invert break-words [&_pre]:overflow-x-auto [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5 [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_h1]:my-2 [&_h2]:my-1.5 [&_h3]:my-1">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children }) => <>{children}</>,
          code: ({ className, children }) => {
            const isBlock = className?.startsWith('language-');
            const lang = className?.replace('language-', '') || '';
            const code = String(children).replace(/\n$/, '');

            if (!isBlock) {
              return (
                <code className="rounded bg-muted px-1 py-0.5 text-xs font-mono">
                  {children}
                </code>
              );
            }

            const isJson = lang === 'json' || lang === 'jsonc';

            return (
              <div className="my-2 rounded-lg border bg-card">
                <div className="flex items-center justify-between px-3 py-1.5 bg-muted/60 border-b text-xs text-muted-foreground">
                  <span className="font-mono">{lang || 'code'}</span>
                  {!isJson && <CopyButton text={code} />}
                </div>
                <pre className="p-3 text-xs font-mono overflow-x-auto max-h-80 overflow-y-auto m-0">
                  <code>{code}</code>
                </pre>
                {isJson && <ChatApplyButton json={code} context={context} />}
              </div>
            );
          },
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
    >
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}
