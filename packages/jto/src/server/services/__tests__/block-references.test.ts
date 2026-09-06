/**
 * The server-side reference catalog feeds two consumers: the editor, over
 * `/discovery/blocks`, and the AI assistant's PPTX prompt, as text. The
 * prompt must carry enough to act on — the definition to copy, the slots and
 * an invocation — and nothing the assistant is told never to emit.
 */
import { describe, expect, it } from 'vitest';
import {
  blockReferencesPrompt,
  discoverBlockReferences,
} from '../block-references';

describe('block reference catalog', () => {
  it('discovers the shipped decks’ blocks from the workspace', async () => {
    const references = await discoverBlockReferences('pptx');
    const names = references.map((entry) => `${entry.template}/${entry.name}`);
    expect(names).toContain('consulting-deck-blocks/action-chart');
    expect(references.every((entry) => entry.format === 'pptx')).toBe(true);
    // Memoized: the same array comes back within the window.
    expect(await discoverBlockReferences('pptx')).toBe(references);
  });

  it('renders each reference as copyable prompt text', async () => {
    const references = await discoverBlockReferences('pptx');
    const text = blockReferencesPrompt(
      references.filter((entry) => entry.name === 'action-chart')
    );
    expect(text).toContain('### `action-chart` (from consulting-deck-blocks)');
    expect(text).toContain('- `title` — string, required, role actionTitle');
    expect(text).toContain('- `chart` — component, required');
    expect(text).toContain('"action-chart": {');
    expect(text).toContain('"ref": "action-chart"');
    expect(text).not.toMatch(/placeholders|"template"/);
    // The definition inside the prompt is the one on disk, byte for byte.
    const fence = /```json\n([\s\S]*?)\n```/.exec(text)!;
    expect(JSON.parse(fence[1])['action-chart']).toEqual(
      references.find((entry) => entry.name === 'action-chart')!.definition
    );
  });

  it('says so when there is nothing to reference', () => {
    expect(blockReferencesPrompt([])).toContain('No reference blocks');
  });
});
