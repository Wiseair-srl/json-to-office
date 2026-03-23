import { useEffect, useRef, useCallback, useState, useMemo, memo } from 'react';
import { Send, X, Loader2, Square, Paperclip, AlertTriangle, Trash2 } from 'lucide-react';
import type { FileUIPart } from 'ai';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../ui/tooltip';
import { KbdShortcut } from '../../ui/kbd';
import { defaultThreadTitle } from '../../../store/chat-store';
import type { AiScope, AiModel } from '../../../store/chat-store';
import { FORMAT } from '../../../lib/env';

const ALLOWED_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'application/pdf',
  'text/plain', 'text/markdown', 'text/csv', 'text/html',
]);
const ACCEPT_STRING = Array.from(ALLOWED_TYPES).join(',');
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB (Claude supports up to 20MB)
const MAX_ATTACHMENTS = 10;

function fileToUIPart(file: File): Promise<FileUIPart> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve({ type: 'file', mediaType: file.type, filename: file.name, url: reader.result as string });
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function filterValidFiles(files: FileList | File[]): File[] {
  return Array.from(files).filter(
    (f) => ALLOWED_TYPES.has(f.type) && f.size <= MAX_FILE_SIZE,
  );
}

function isImageType(mediaType: string): boolean {
  return mediaType.startsWith('image/');
}

export function ChatPanel() {
  const contextAttachments = useChatStore((s) => s.contextAttachments);
  const addContext = useChatStore((s) => s.addContext);
  const removeContext = useChatStore((s) => s.removeContext);
  const scope = useChatStore((s) => s.scope);
  const setScope = useChatStore((s) => s.setScope);
  const model = useChatStore((s) => s.model);
  const setModel = useChatStore((s) => s.setModel);
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

  const { messages, sendMessage, status, error, setMessages, stop, getMessageContext, getMessageScope } = useChatSessionContext();

  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<FileUIPart[]>([]);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addAttachments = useCallback(async (files: File[]) => {
    const valid = filterValidFiles(files);
    if (valid.length === 0) return;
    const parts = await Promise.all(valid.map(fileToUIPart));
    setAttachments((prev) => {
      const combined = [...prev, ...parts];
      if (combined.length > MAX_ATTACHMENTS) {
        return combined.slice(0, MAX_ATTACHMENTS);
      }
      return combined;
    });
  }, []);

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const files = e.clipboardData?.files;
      if (files && files.length > 0) {
        const images = filterValidFiles(files);
        if (images.length > 0) {
          e.preventDefault();
          addAttachments(images);
        }
      }
    },
    [addAttachments],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) addAttachments(Array.from(files));
    },
    [addAttachments],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => setDragOver(false), []);

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

  // Orphan cleanup: delete threads for docs that no longer exist.
  // Read threads via ref to avoid re-triggering when deleteThreadsForDocument mutates threads.
  const threadsCleanupRef = useRef(threads);
  threadsCleanupRef.current = threads;
  useEffect(() => {
    const docNames = new Set(documents.map((d) => d.name));
    const orphanDocs = new Set<string>();
    for (const thread of Object.values(threadsCleanupRef.current)) {
      if (!docNames.has(thread.documentName) && thread.documentName !== '__migrated__') {
        orphanDocs.add(thread.documentName);
      }
    }
    for (const docName of orphanDocs) {
      deleteThreadsForDocument(docName);
    }
  }, [documents, deleteThreadsForDocument]);

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
      if ((!input.trim() && attachments.length === 0) || isLoading) return;
      sendMessage(input, attachments.length > 0 ? attachments : undefined);
      setInput('');
      setAttachments([]);
    },
    [input, attachments, isLoading, sendMessage]
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

  const [deleteMessageId, setDeleteMessageId] = useState<string | null>(null);

  const requestDeleteMessage = useCallback((msgId: string) => {
    setDeleteMessageId(msgId);
  }, []);

  const confirmDeleteMessage = useCallback(() => {
    if (!deleteMessageId) return;
    const idx = messages.findIndex((m) => m.id === deleteMessageId);
    if (idx === -1) { setDeleteMessageId(null); return; }
    const msg = messages[idx];
    const toRemove = new Set<number>([idx]);
    if (msg.role === 'user' && messages[idx + 1]?.role === 'assistant') {
      toRemove.add(idx + 1);
    } else if (msg.role === 'assistant' && idx > 0 && messages[idx - 1]?.role === 'user') {
      toRemove.add(idx - 1);
    }
    const filtered = messages.filter((_, i) => !toRemove.has(i));
    setMessages(filtered);
    if (activeThreadId) updateThreadMessages(activeThreadId, filtered as any);
    setDeleteMessageId(null);
  }, [deleteMessageId, messages, setMessages, activeThreadId, updateThreadMessages]);

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
            const msgScope = msg.role === 'user' ? getMessageScope(msg.id) : undefined;

            return (
              <ChatMessage
                key={msg.id}
                msg={msg}
                isStreaming={isMsgStreaming}
                context={msgContext}
                scope={msgScope}
                onDelete={!isLoading ? requestDeleteMessage : undefined}
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
          {error && !isLoading && (
            <div className="flex justify-start">
              <div className="rounded-lg px-3 py-2 bg-destructive/10 border border-destructive/30 text-destructive text-sm max-w-[90%]">
                {error.message || 'Something went wrong'}
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Context chips + image previews + input */}
      <div
        className={`border-t border-border/60 p-2.5 space-y-2 bg-surface-chat transition-colors ${dragOver ? 'ring-2 ring-primary/40 bg-primary/5' : ''}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
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
        <div className="flex items-center gap-3 flex-wrap">
          <ModelSelector model={model} setModel={setModel} />
          {FORMAT === 'pptx' && activeTab && (
            <ScopeSelector scope={scope} setScope={setScope} docSize={documents.find((d) => d.name === activeTab)?.text?.length ?? 0} />
          )}
        </div>
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {attachments.map((f, i) => (
              <div key={i} className="relative group">
                {isImageType(f.mediaType) ? (
                  <img
                    src={f.url}
                    alt={f.filename || 'attachment'}
                    className="h-14 w-14 rounded-md object-cover border border-border/60"
                  />
                ) : (
                  <div className="h-14 px-2.5 flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/60 max-w-[140px]">
                    <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="text-xs truncate text-muted-foreground">{f.filename || 'file'}</span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => removeAttachment(i)}
                  className="absolute -top-1.5 -right-1.5 rounded-full bg-destructive text-destructive-foreground p-0.5 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <form onSubmit={handleSubmit} className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT_STRING}
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) addAttachments(Array.from(e.target.files));
              e.target.value = '';
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0 h-9 w-9 rounded-lg text-muted-foreground hover:text-foreground"
            onClick={() => fileInputRef.current?.click()}
            title="Attach file"
          >
            <Paperclip className="h-4 w-4" />
          </Button>
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
            onPaste={handlePaste}
            placeholder={
              contextAttachments.length > 0
                ? 'Describe how to edit the selection...'
                : scope === 'slides'
                  ? 'Add, edit, or remove slides...'
                  : scope === 'templates'
                    ? 'Edit template layouts and placeholders...'
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
              disabled={!input.trim() && attachments.length === 0}
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
      <Dialog open={deleteMessageId !== null} onOpenChange={(open) => { if (!open) setDeleteMessageId(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete message</DialogTitle>
            <DialogDescription>
              This will delete the message and its paired response. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" size="sm">Cancel</Button>
            </DialogClose>
            <Button variant="destructive" size="sm" onClick={confirmDeleteMessage}>
              Delete
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
  scope,
  onDelete,
}: {
  msg: any;
  isStreaming: boolean;
  context?: any[];
  scope?: AiScope;
  onDelete?: (id: string) => void;
}) {
  const text = msg.parts
    ?.filter((p: any) => p.type === 'text')
    .map((p: any) => p.text)
    .join('') || '';
  const fileParts = msg.parts?.filter((p: any) => p.type === 'file') || [];

  return (
    <div className={`group/msg flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`rounded-lg px-3 py-2 max-w-[90%] overflow-hidden min-w-0 ${
          msg.role === 'user'
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted/60 border border-border/40'
        }`}
      >
        {msg.role === 'user' ? (
          <div>
            {fileParts.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-1.5">
                {fileParts.map((f: any, i: number) =>
                  isImageType(f.mediaType) ? (
                    <img
                      key={i}
                      src={f.url}
                      alt={f.filename || 'image'}
                      className="h-20 max-w-[160px] rounded object-cover"
                    />
                  ) : (
                    <div key={i} className="flex items-center gap-1.5 rounded bg-primary-foreground/20 px-2 py-1">
                      <Paperclip className="h-3 w-3 shrink-0" />
                      <span className="text-xs truncate max-w-[120px]">{f.filename || 'file'}</span>
                    </div>
                  ),
                )}
              </div>
            )}
            {text && <div className="whitespace-pre-wrap text-sm break-words">{text}</div>}
            {scope && scope !== 'global' && (
              <span className="text-[10px] text-primary-foreground/60 mt-0.5 block text-right">{scope}</span>
            )}
          </div>
        ) : (
          <AssistantMessage text={text} isStreaming={isStreaming} context={context} />
        )}
        {onDelete && !isStreaming && (
          <div className="opacity-0 group-hover/msg:opacity-100 transition-opacity mt-1">
            <button
              type="button"
              onClick={() => onDelete(msg.id)}
              className={`p-0.5 rounded cursor-pointer ${msg.role === 'user' ? 'text-primary-foreground/50 hover:text-primary-foreground/80' : 'text-muted-foreground hover:text-destructive'}`}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}, (prev, next) => prev.msg.id === next.msg.id && prev.isStreaming === next.isStreaming && prev.scope === next.scope && prev.onDelete === next.onDelete);

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

const MODEL_OPTIONS: { value: AiModel; label: string }[] = [
  { value: 'opus', label: 'Opus' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'haiku', label: 'Haiku' },
];

function ModelSelector({ model, setModel }: { model: AiModel; setModel: (m: AiModel) => void }) {
  return (
    <Select value={model} onValueChange={(v) => setModel(v as AiModel)}>
      <SelectTrigger className="h-6 w-auto gap-1 border-none bg-muted/40 px-2 py-0 text-[10px] shadow-none focus:ring-0">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {MODEL_OPTIONS.map((m) => (
          <SelectItem key={m.value} value={m.value} className="text-xs">
            {m.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const SCOPE_HINTS: Record<AiScope, string> = {
  global: 'AI sees and edits the entire document',
  slides: 'AI sees and edits only slides — templates stay unchanged',
  templates: 'AI sees and edits only template layouts — slides stay unchanged',
};
const LARGE_DOC_THRESHOLD = 100_000;

function ScopeSelector({ scope, setScope, docSize }: { scope: AiScope; setScope: (s: AiScope) => void; docSize: number }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-muted-foreground">Scope</span>
        <div className="flex items-center bg-muted/40 rounded-md p-0.5 gap-px">
          {(Object.keys(SCOPE_HINTS) as AiScope[]).map((s) => (
            <Tooltip key={s}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setScope(s)}
                  className={`px-2 py-0.5 rounded text-[10px] cursor-pointer transition-colors ${
                    scope === s
                      ? 'bg-background text-foreground font-medium shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >{s}</button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs max-w-[200px]">
                {SCOPE_HINTS[s]}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      </div>
      {scope === 'global' && docSize > LARGE_DOC_THRESHOLD && (
        <div className="text-[10px] text-amber-500 flex items-center gap-1">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          <span>Large doc — switch to{' '}
            <button type="button" onClick={() => setScope('slides')} className="underline cursor-pointer hover:text-amber-400">slides</button>
            {' '}or{' '}
            <button type="button" onClick={() => setScope('templates')} className="underline cursor-pointer hover:text-amber-400">templates</button>
          </span>
        </div>
      )}
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
