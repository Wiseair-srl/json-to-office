import { Hono } from 'hono';
import { streamText, convertToModelMessages } from 'ai';
import { claudeCode } from 'ai-sdk-provider-claude-code';
import { AppEnv } from '../types/hono.js';
import { getSchemaString, getFormatFromContainer } from '../services/ai-schema.js';
import { loadPrompt } from '../services/prompt-loader.js';
import { logger } from '../utils/logger.js';

const MAX_DOC_CHARS = 100_000; // ~25k tokens

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return text.slice(0, limit) + `\n...(truncated, showing first ${limit} chars)`;
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
        const editDocInstructions = loadPrompt('instructions-edit-document.md', {
          contentLabel,
          contentLabelLower: contentLabel.toLowerCase(),
          documentName: activeDocument.name || 'untitled',
          documentText: docText,
        });
        systemPrompt += '\n\n' + editDocInstructions;
      } else if (!activeDocument?.text && (!context || context.length === 0)) {
        // Truly from-scratch generation — no document open
        const generateInstructions = loadPrompt('instructions-generate.md', {
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

      const result = streamText({
        model: claudeCode('opus'),
        system: systemPrompt,
        messages: await convertToModelMessages(allMessages),
      });

      return result.toUIMessageStreamResponse();
    } catch (error: any) {
      logger.error('AI chat error', { error: error.message });
      return c.json({ error: error.message }, 500);
    }
  });

  return router;
}
