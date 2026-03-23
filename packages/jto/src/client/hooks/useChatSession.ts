import { useRef, useCallback } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage, type FileUIPart } from 'ai';
import { useChatStore } from '../store/chat-store-provider';
import { useDocumentsStore } from '../store/documents-store-provider';
import { FORMAT } from '../lib/env';
import { mergeAiOutput, applyId } from '../lib/apply-merge';
import type { SelectionContext } from '../lib/monaco-selection-utils';
import type { AiScope } from '../store/chat-store';

type ContextEntry = (SelectionContext & { documentName?: string })[];

/** Validate & return the last JSON code block, preserving original formatting. */
function tryParseJsonBlocks(blocks: RegExpMatchArray[]): string | null {
  const raw = blocks[blocks.length - 1][1];
  try { JSON.parse(raw); return raw; } catch {}
  if (blocks.length > 1) {
    const combined = blocks.map(m => m[1]).join('\n');
    try { JSON.parse(combined); return combined; } catch {}
  }
  return null;
}

/**
 * Structured JSON merge for scoped AI output.
 * Instead of text-based heuristics, parses both JSONs and replaces
 * the exact key path based on scope. Returns null if scope is global
 * or if parsing fails (falls back to mergeAiOutput).
 */
function scopedMerge(
  currentDoc: string,
  aiOutput: string,
  scope: AiScope,
): { original: string; modified: string } | null {
  if (scope === 'global') return null;
  try {
    const doc = JSON.parse(currentDoc);
    const fragment = JSON.parse(aiOutput);
    if (scope === 'slides' && Array.isArray(fragment.children)) {
      doc.children = fragment.children;
    } else if (scope === 'templates' && Array.isArray(fragment.templates)) {
      if (!doc.props) doc.props = {};
      doc.props.templates = fragment.templates;
    } else {
      return null; // unexpected shape, fall back
    }
    return { original: currentDoc, modified: JSON.stringify(doc, null, 2) };
  } catch {
    return null;
  }
}

export function useChatSession() {
  const threads = useChatStore((s) => s.threads);
  const activeThreadIdMap = useChatStore((s) => s.activeThreadId);
  const updateThreadMessages = useChatStore((s) => s.updateThreadMessages);
  const updateThreadTitle = useChatStore((s) => s.updateThreadTitle);
  const clearContext = useChatStore((s) => s.clearContext);
  const contextAttachments = useChatStore((s) => s.contextAttachments);
  const scope = useChatStore((s) => s.scope);
  const model = useChatStore((s) => s.model);

  const activeTab = useDocumentsStore((s) => s.activeTab);
  const documents = useDocumentsStore((s) => s.documents);
  const documentTypes = useDocumentsStore((s) => s.documentTypes);
  const setPendingDiff = useDocumentsStore((s) => s.setPendingDiff);
  const createDocument = useDocumentsStore((s) => s.createDocument);
  const openDocument = useDocumentsStore((s) => s.openDocument);

  // Refs so onFinish always reads current values
  const threadsRef = useRef(threads);
  threadsRef.current = threads;
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  const documentsRef = useRef(documents);
  documentsRef.current = documents;
  const documentTypesRef = useRef(documentTypes);
  documentTypesRef.current = documentTypes;
  const activeThreadIdMapRef = useRef(activeThreadIdMap);
  activeThreadIdMapRef.current = activeThreadIdMap;

  const activeThreadId = activeTab ? activeThreadIdMap[activeTab] : undefined;
  const activeThreadIdRef = useRef(activeThreadId);
  activeThreadIdRef.current = activeThreadId;

  // Per-message context & scope: queue for pending sends, map for completed
  const pendingContextsRef = useRef<ContextEntry[]>([]);
  const pendingScopesRef = useRef<AiScope[]>([]);
  const messageContextMapRef = useRef<Record<string, ContextEntry>>({});
  const messageScopeMapRef = useRef<Record<string, AiScope>>({});

  const transportRef = useRef<DefaultChatTransport<UIMessage> | null>(null);
  if (!transportRef.current) {
    transportRef.current = new DefaultChatTransport<UIMessage>({ api: '/api/ai/chat' });
  }

  const getActiveDocument = useCallback(() => {
    const doc = documentsRef.current.find((d) => d.name === activeTabRef.current);
    return doc ? { name: doc.name, text: doc.text } : undefined;
  }, []);

  const getMessageContext = useCallback((userMsgId: string): ContextEntry => {
    return messageContextMapRef.current[userMsgId] || [];
  }, []);

  const chat = useChat({
    transport: transportRef.current,
    onError: () => {
      pendingContextsRef.current.shift();
      pendingScopesRef.current.shift();
      clearContext();
    },
    onFinish: ({ messages: allMsgs }) => {
      const tid = activeThreadIdRef.current;
      if (tid) {
        updateThreadMessages(tid, allMsgs as any);
        // Auto-title from first user message
        const thread = threadsRef.current[tid];
        if (thread && thread.title.startsWith('Chat ')) {
          const firstUserMsg = (allMsgs as any[]).find((m) => m.role === 'user');
          if (firstUserMsg) {
            const text =
              firstUserMsg.parts
                ?.filter((p: any) => p.type === 'text')
                .map((p: any) => p.text)
                .join('') || '';
            if (text) {
              const title = text.length > 50 ? text.slice(0, 50) + '...' : text;
              updateThreadTitle(tid, title);
            }
          }
        }
      }

      // Pop context + scope from queue (captured at send time)
      const sendContext = pendingContextsRef.current.shift() || [];
      const sendScope = pendingScopesRef.current.shift() || 'global';

      // Store context + scope keyed by the user message that triggered this response
      const userMsgs = (allMsgs as any[]).filter((m) => m.role === 'user');
      const lastUserMsg = userMsgs[userMsgs.length - 1];
      if (lastUserMsg?.id) {
        messageContextMapRef.current[lastUserMsg.id] = sendContext;
        messageScopeMapRef.current[lastUserMsg.id] = sendScope;
      }

      // Auto-apply: extract last JSON code block from assistant response
      const lastMsg = (allMsgs as any[]).filter((m) => m.role === 'assistant').pop();
      if (lastMsg) {
        const fullText = lastMsg.parts
          ?.filter((p: any) => p.type === 'text')
          .map((p: any) => p.text)
          .join('') || '';
        const jsonBlocks = [...fullText.matchAll(/```(?:json|jsonc)\s*\n([\s\S]*?)```/g)];
        if (jsonBlocks.length > 0) {
          const formatted = tryParseJsonBlocks(jsonBlocks);
          if (formatted) {
            const raw = jsonBlocks[jsonBlocks.length - 1][1];
            const tab = activeTabRef.current;
            if (tab) {
              const doc = documentsRef.current.find((d) => d.name === tab);
              const original = doc?.text || '';
              const ctx = sendContext[0];
              const scopedResult = scopedMerge(original, formatted, sendScope);
              if (!scopedResult && sendScope !== 'global') {
                console.warn(`[chat] scopedMerge failed for scope="${sendScope}", falling back to text merge`);
              }
              const { original: orig, modified } = scopedResult
                ?? mergeAiOutput(original, formatted, ctx);
              setPendingDiff(tab, orig, modified, applyId(raw.replace(/\n$/, '')));
            } else {
              const name = `ai-generated-${Date.now()}`;
              createDocument(name, formatted);
              openDocument(name);
            }
          }
        }
      }
      clearContext();
    },
  });

  const wrappedSendMessage = useCallback(
    (input: string, files?: FileUIPart[]) => {
      // Capture context + scope at send time into the queue
      pendingContextsRef.current.push([...contextAttachments]);
      pendingScopesRef.current.push(scope);
      clearContext();
      const message: { text: string; files?: FileUIPart[] } = { text: input };
      if (files?.length) message.files = files;
      chat.sendMessage(message, {
        body: {
          format: FORMAT,
          context: contextAttachments,
          activeDocument: getActiveDocument(),
          documentType: (activeTabRef.current && documentTypesRef.current[activeTabRef.current]) || 'application/json+report',
          scope,
          model,
        },
      });
    },
    [chat.sendMessage, contextAttachments, getActiveDocument, clearContext, scope, model]
  );

  const getMessageScope = useCallback((userMsgId: string): AiScope | undefined => {
    return messageScopeMapRef.current[userMsgId];
  }, []);

  return {
    messages: chat.messages,
    sendMessage: wrappedSendMessage,
    status: chat.status,
    error: chat.error,
    setMessages: chat.setMessages,
    stop: chat.stop,
    getMessageContext,
    getMessageScope,
  };
}
