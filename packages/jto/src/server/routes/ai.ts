import { Hono } from 'hono';
import { streamText, convertToModelMessages, type ModelMessage } from 'ai';
import { claudeCode } from 'ai-sdk-provider-claude-code';
import { extractText as extractPdfText } from 'unpdf';
import { AppEnv } from '../types/hono.js';
import { getSchemaString, getFormatFromContainer } from '../services/ai-schema.js';
import { loadPrompt } from '../services/prompt-loader.js';
import { logger } from '../utils/logger.js';
import { rateLimiter } from '../middleware/hono/rate-limit.js';

function sanitizeFilename(name: string): string {
  return name.replace(/[[\]\n\r]/g, '_');
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
          const text = await extractFileText(mime, part.data);
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

  router.post('/chat',
    rateLimiter({
      limit: process.env.NODE_ENV === 'production' ? 30 : 1000,
      window: 15 * 60 * 1000,
      keyGenerator: (c) => c.req.header('X-Real-IP') || c.req.header('X-Forwarded-For')?.split(',').pop()?.trim() || 'anonymous',
    }),
    async (c) => {
    try {
      const body = await c.req.json();
      const { messages, context, format: clientFormat, activeDocument, documentType, scope, model: requestedModel } = body;
      const VALID_MODELS = ['opus', 'sonnet', 'haiku'] as const;
      const model = VALID_MODELS.includes(requestedModel) ? requestedModel : 'opus';

      const format = clientFormat || getFormatFromContainer();
      const isTheme = documentType === 'application/json+theme';
      const schemaStr = await getSchemaString(format, isTheme ? 'theme' : 'document');
      const contentLabel = isTheme ? 'Theme' : 'Document';

      // === Prompt assembly: base → format → format+design → mode ===

      // Layer 1: Base
      let systemPrompt = loadPrompt(isTheme ? 'system-theme.md' : 'system.md', {
        format,
        schema: schemaStr,
      });

      // Layer 2: Format-specific core (always loaded)
      if (!isTheme) {
        if (format === 'pptx') {
          systemPrompt += '\n\n' + loadPrompt('pptx-core.md');
        } else if (format === 'docx') {
          systemPrompt += '\n\n' + loadPrompt('instructions-docx.md');
        }
      }

      // Determine mode: selection-edit, edit-document, or generate
      const hasSelection = context && context.length > 0 && context[0]?.selectedText;
      const hasActiveDoc = !hasSelection && activeDocument?.text;
      const isGenerate = !hasSelection && !hasActiveDoc;

      // Layer 3: Format+design (generate and edit-document only, not selection-edit)
      if (!isTheme && format === 'pptx' && !hasSelection) {
        systemPrompt += '\n\n' + loadPrompt('pptx-design.md');
      }

      // Layer 4: Mode-specific instructions
      if (hasSelection) {
        const ctx = context[0];
        // Use pptx-aware selection editing for pptx, generic for others
        const editFile = format === 'pptx' && !isTheme
          ? 'instructions-edit-pptx.md'
          : 'instructions-edit.md';
        systemPrompt += '\n\n' + loadPrompt(editFile, {
          documentName: ctx.documentName || 'unknown',
          jsonPath: ctx.jsonPath || '',
          selectedText: ctx.selectedText,
        });
      } else if (hasActiveDoc) {
        const pptxScope = format === 'pptx' && !isTheme && (scope === 'slides' || scope === 'templates');

        let parsedDoc: any = null;
        if (pptxScope) {
          try { parsedDoc = JSON.parse(activeDocument.text); } catch { /* fall through to global */ }
        }

        if (pptxScope && parsedDoc) {
          const doc = parsedDoc;

          if (scope === 'slides') {
            const templatesSummary = (doc.props?.templates || []).map((m: any) => {
              const phs = (m.placeholders || [])
                .map((p: any) => {
                  const d = p.defaults ? ` → defaults: ${JSON.stringify(p.defaults)}` : '';
                  return `  - \`${p.name}\`${d}`;
                }).join('\n');
              return `**${m.name}**\n${phs}`;
            }).join('\n\n');
            const slidesText = JSON.stringify(doc.children || [], null, 2);
            systemPrompt += '\n\n' + loadPrompt('instructions-edit-document-pptx-slides.md', {
              documentName: activeDocument.name || 'untitled',
              templatesSummary,
              slidesText,
            });
          } else {
            const templatesText = JSON.stringify(doc.props?.templates || [], null, 2);
            const slidesSummary = (doc.children || []).map((s: any, i: number) => {
              const template = s.props?.template || '(none)';
              const phs = Object.keys(s.props?.placeholders || {}).join(', ');
              return `  ${i}: template=${template}, placeholders=[${phs}]`;
            }).join('\n');
            systemPrompt += '\n\n' + loadPrompt('instructions-edit-document-pptx-templates.md', {
              documentName: activeDocument.name || 'untitled',
              templatesText,
              slidesSummary,
            });
          }
        } else {
          const editDocFiles: Record<string, string> = {
            pptx: 'instructions-edit-document-pptx.md',
            docx: 'instructions-edit-document-docx.md',
          };
          const editDocFile = isTheme
            ? 'instructions-edit-document.md'
            : editDocFiles[format] ?? 'instructions-edit-document.md';
          systemPrompt += '\n\n' + loadPrompt(editDocFile, {
            contentLabel,
            contentLabelLower: contentLabel.toLowerCase(),
            documentName: activeDocument.name || 'untitled',
            documentText: activeDocument.text,
          });
        }
      } else if (isGenerate) {
        const generateFiles: Record<string, string> = {
          pptx: 'instructions-generate-pptx.md',
          docx: 'instructions-generate-docx.md',
        };
        const generateFile = isTheme
          ? 'instructions-generate.md'
          : generateFiles[format] ?? 'instructions-generate.md';
        systemPrompt += '\n\n' + loadPrompt(generateFile, {
          contentType: isTheme ? 'theme' : 'document',
        });
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
        model: claudeCode(model, { streamingInput: 'always' }),
        system: systemPrompt,
        messages: modelMessages,
      });

      return result.toUIMessageStreamResponse();
    } catch (error: any) {
      const message = error.message || 'Unknown error';
      const status = error.status || error.statusCode || 500;

      if (status === 429 || message.includes('rate')) {
        logger.warn('AI rate limit hit', { error: message });
        return c.json({ error: 'Rate limit exceeded. Please wait before sending another message.' }, 429);
      }
      if (status === 413 || message.includes('too large') || message.includes('too long')) {
        logger.warn('AI request too large', { error: message });
        return c.json({ error: 'Request too large for the AI model. Try selecting a smaller portion of the document.' }, 413);
      }
      if (error.name === 'AbortError' || message.includes('abort')) {
        logger.info('AI request aborted');
        return c.json({ error: 'Request was cancelled.' }, 400);
      }

      logger.error('AI chat error', { error: message, stack: error.stack });
      return c.json({ error: process.env.NODE_ENV === 'production' ? 'Something went wrong. Please try again.' : message }, 500);
    }
  });

  return router;
}
