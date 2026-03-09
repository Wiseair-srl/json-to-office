/**
 * Reads .md prompt files from the prompts/ directory and interpolates {{var}} placeholders.
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// In dev (tsx): __dirname = src/server/services → ../prompts
// In prod (tsup): __dirname = dist → look for prompts in src/server/prompts (fallback)
function resolvePromptsDir(): string {
  const candidates = [
    join(__dirname, '..', 'prompts'),           // dev: src/server/prompts
    join(__dirname, 'prompts'),                  // bundled: dist/prompts
    join(__dirname, '..', 'src', 'server', 'prompts'), // prod from dist/
  ];
  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  return candidates[0]; // fallback — will error on read if missing
}

const PROMPTS_DIR = resolvePromptsDir();

const cache = new Map<string, string>();

function readPromptFile(name: string): string {
  if (cache.has(name)) return cache.get(name)!;
  const filePath = join(PROMPTS_DIR, name);
  const content = readFileSync(filePath, 'utf-8');
  cache.set(name, content);
  return content;
}

export function loadPrompt(
  name: string,
  vars: Record<string, string> = {}
): string {
  let content = readPromptFile(name);
  for (const [key, value] of Object.entries(vars)) {
    content = content.replaceAll(`{{${key}}}`, value);
  }
  return content;
}
