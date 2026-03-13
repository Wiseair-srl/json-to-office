import { Hono } from 'hono';
import { streamText, convertToModelMessages, type ModelMessage } from 'ai';
import { claudeCode } from 'ai-sdk-provider-claude-code';
import { extractText as extractPdfText } from 'unpdf';
import { AppEnv } from '../types/hono.js';
import { getSchemaString, getFormatFromContainer } from '../services/ai-schema.js';
import { loadPrompt } from '../services/prompt-loader.js';
import { logger } from '../utils/logger.js';

const MAX_DOC_CHARS = 100_000; // ~25k tokens

function sanitizeFilename(name: string): string {
  return name.replace(/[\[\]\n\r]/g, '_');
}

/**
 * Convert data: URL file parts to inline base64 so providers that
 * reject data: URLs (e.g. claude-code) can consume them.
 */
function fixDataUrlFileParts(messages: ModelMessage[]): ModelMessage[] {
  for (const msg of messages) {
    if (msg.role !== 'user' || typeof msg.content === 'string') continue;
    for (const part of msg.content) {
      if (part.type !== 'file') continue;
      const data = part.data;
      if (data instanceof URL && data.protocol === 'data:') {
        const str = data.toString();
        const commaIdx = str.indexOf(',');
        if (commaIdx !== -1) {
          const isBase64 = str.slice(0, commaIdx).includes(';base64');
          const payload = str.slice(commaIdx + 1);
          part.data = isBase64 ? payload : Buffer.from(decodeURIComponent(payload), 'utf-8').toString('base64');
        }
      } else if (typeof data === 'string' && data.startsWith('data:')) {
        const commaIdx = data.indexOf(',');
        if (commaIdx !== -1) {
          const isBase64 = data.slice(0, commaIdx).includes(';base64');
          const payload = data.slice(commaIdx + 1);
          part.data = isBase64 ? payload : Buffer.from(decodeURIComponent(payload), 'utf-8').toString('base64');
        }
      }
    }
  }
  return messages;
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return text.slice(0, limit) + `\n...(truncated, showing first ${limit} chars)`;
}

const TEXT_MIME_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/html',
]);

function toBuffer(data: string | Uint8Array | ArrayBuffer | URL): Buffer {
  if (data instanceof ArrayBuffer) return Buffer.from(new Uint8Array(data));
  if (data instanceof Uint8Array) return Buffer.from(data);
  if (data instanceof URL) {
    const str = data.toString();
    const commaIdx = str.indexOf(',');
    if (commaIdx === -1) return Buffer.from(str, 'base64');
    const isBase64 = str.slice(0, commaIdx).includes(';base64');
    const payload = str.slice(commaIdx + 1);
    return isBase64
      ? Buffer.from(payload, 'base64')
      : Buffer.from(decodeURIComponent(payload), 'utf-8');
  }
  // base64 string (or raw data: string already stripped by fixDataUrlFileParts)
  return Buffer.from(data, 'base64');
}

async function extractFileText(
  mimeType: string,
  data: string | Uint8Array | ArrayBuffer | URL,
): Promise<string> {
  const buf = toBuffer(data);
  if (mimeType === 'application/pdf') {
    const { text } = await extractPdfText(new Uint8Array(buf));
    return Array.isArray(text) ? text.join('\n') : String(text);
  }
  // text/* types
  return buf.toString('utf-8');
}

async function extractNonImageFileParts(
  messages: ModelMessage[],
): Promise<ModelMessage[]> {
  for (const msg of messages) {
    if (msg.role !== 'user' || typeof msg.content === 'string') continue;
    const newContent: typeof msg.content = [];
    for (const part of msg.content) {
      if (part.type !== 'file') {
        newContent.push(part);
        continue;
      }
      const mime = part.mediaType ?? '';
      // Images pass through — the provider handles them
      if (mime.startsWith('image/')) {
        newContent.push(part);
        continue;
      }
      // Non-image file: extract text
      if (mime === 'application/pdf' || TEXT_MIME_TYPES.has(mime)) {
        const filename = sanitizeFilename((part as any).filename || 'file');
        try {
          const raw = await extractFileText(mime, part.data);
          const text = truncate(raw, MAX_DOC_CHARS);
          newContent.push({ type: 'text' as const, text: `[Attached file: ${filename}]\n${text}` });
        } catch (err: any) {
          logger.warn('Failed to extract file content', { filename, mime, error: err.message });
          newContent.push({ type: 'text' as const, text: `[Attached file: ${filename} — could not extract content]` });
        }
      } else {
        // Unknown MIME — mention it but don't crash
        const filename = sanitizeFilename((part as any).filename || 'file');
        newContent.push({ type: 'text' as const, text: `[Attached file: ${filename} — unsupported format: ${mime}]` });
      }
    }
    msg.content = newContent;
  }
  return messages;
}

export function createAiRouter() {
  const router = new Hono<AppEnv>();

  router.post('/chat', async (c) => {
    try {
      const body = await c.req.json();
      const { messages, context, format: clientFormat, activeDocument, documentType } = body;

      const format = clientFormat || getFormatFromContainer();
      const isTheme = documentType === 'application/json+theme';
      const schemaStr = await getSchemaString(format, isTheme ? 'theme' : 'document');
      const contentLabel = isTheme ? 'Theme' : 'Document';

      // Build system prompt
      let systemPrompt = loadPrompt(isTheme ? 'system-theme.md' : 'system.md', {
        format,
        schema: schemaStr,
      });

      // Append PPTX-specific addendum for non-theme PPTX interactions
      if (format === 'pptx' && !isTheme) {
        systemPrompt += '\n\n' + loadPrompt('instructions-pptx.md');
      }

      // Append edit instructions when a selection context is provided
      if (context && context.length > 0) {
        const ctx = context[0];
        if (ctx.selectedText) {
          const selectedText = truncate(ctx.selectedText, MAX_DOC_CHARS);
          if (selectedText !== ctx.selectedText) {
            logger.warn('Truncated selectedText in AI context', { originalLength: ctx.selectedText.length });
          }
          const editInstructions = loadPrompt('instructions-edit.md', {
            documentName: ctx.documentName || 'unknown',
            jsonPath: ctx.jsonPath || '',
            selectedText,
          });
          systemPrompt += '\n\n' + editInstructions;
        }
      }

      // When no selection context but an active document exists, include it so AI can integrate changes
      if (activeDocument?.text && (!context || context.length === 0)) {
        const docText = truncate(activeDocument.text, MAX_DOC_CHARS);
        if (docText !== activeDocument.text) {
          logger.warn('Truncated activeDocument.text in AI system prompt', { originalLength: activeDocument.text.length });
        }
        const editDocFile = format === 'pptx' && !isTheme
          ? 'instructions-edit-document-pptx.md'
          : 'instructions-edit-document.md';
        const editDocInstructions = loadPrompt(editDocFile, {
          contentLabel,
          contentLabelLower: contentLabel.toLowerCase(),
          documentName: activeDocument.name || 'untitled',
          documentText: docText,
        });
        systemPrompt += '\n\n' + editDocInstructions;
      } else if (!activeDocument?.text && (!context || context.length === 0)) {
        // Truly from-scratch generation — no document open
        const generateFile = format === 'pptx' && !isTheme
          ? 'instructions-generate-pptx.md'
          : 'instructions-generate.md';
        const generateInstructions = loadPrompt(generateFile, {
          contentType: isTheme ? 'theme' : 'document',
        });
        systemPrompt += '\n\n' + generateInstructions;
      }

      // If context is provided (selection from editor), prepend as a user message
      const allMessages = [...messages];
      if (context && context.length > 0) {
        const contextParts = context.map((ctx: any) => {
          const parts: string[] = [];
          if (ctx.documentName) parts.push(`Document: ${ctx.documentName}`);
          if (ctx.jsonPath) parts.push(`JSON Path: ${ctx.jsonPath}`);
          if (ctx.selectedText) parts.push(`Selected:\n\`\`\`json\n${ctx.selectedText}\n\`\`\``);
          return parts.join('\n');
        });

        // Insert context as a system-style user message before the last user message
        const lastMsg = allMessages[allMessages.length - 1];
        if (lastMsg && lastMsg.role === 'user') {
          const contextPrefix = `[Editor Context]\n${contextParts.join('\n---\n')}\n\n`;
          // Prepend context to the last user message text
          if (typeof lastMsg.content === 'string') {
            lastMsg.content = contextPrefix + lastMsg.content;
          } else if (Array.isArray(lastMsg.parts)) {
            lastMsg.parts = [
              { type: 'text', text: contextPrefix },
              ...lastMsg.parts,
            ];
          }
        }
      }

      const modelMessages = await extractNonImageFileParts(
        fixDataUrlFileParts(await convertToModelMessages(allMessages)),
      );

      const result = streamText({
        model: claudeCode('opus', { streamingInput: 'always' }),
        system: systemPrompt,
        messages: modelMessages,
      });

      return result.toUIMessageStreamResponse();
    } catch (error: any) {
      logger.error('AI chat error', { error: error.message });
      return c.json({ error: error.message }, 500);
    }
  });

  return router;
}
