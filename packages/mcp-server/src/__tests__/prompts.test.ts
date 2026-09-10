/**
 * The three entry points (#348).
 *
 * A prompt is only worth shipping if it renders, if what it renders is true of
 * the tools, and if it does not quietly become a second copy of the design
 * rules. So each is listed with its arguments, rendered with representative
 * ones, checked against the blueprint and theme registries it claims to name,
 * and checked for what it must NOT say.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { InMemoryTransport } from '@modelcontextprotocol/server';
import { Client } from '@modelcontextprotocol/client';

import { createServer } from '../server.js';
import { createToolDeps } from '../lib/deps.js';
import { loadCore } from '../lib/core.js';

let client: Client;

const NAMES = ['design-brief', 'report-from-notes', 'deck-from-outline'];

/** Representative arguments: what a person would actually type. */
const SAMPLES: Record<string, Record<string, string>> = {
  'design-brief': {
    subject: 'Why our delivery times slipped in Q3 and what we changed',
    audience: 'the client’s operations director',
    format: 'docx',
  },
  'report-from-notes': {
    notes:
      '# Q3\n- churn down\n- two accounts expanded\nDelivery stabilised in April.',
    client: 'Example client',
    title: 'Delivery stabilised and churn fell',
  },
  'deck-from-outline': {
    outline: '## The quarter in numbers\n- Churn: 3.1%\n- NPS: 62',
    client: 'Example client',
  },
};

async function render(name: string): Promise<string> {
  const result = await client.getPrompt({
    name,
    arguments: SAMPLES[name],
  });
  return result.messages
    .map((m) => (m.content.type === 'text' ? m.content.text : ''))
    .join('\n');
}

beforeAll(async () => {
  const server = createServer(createToolDeps({ serverVersion: '9.9.9-test' }));
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'prompts-test', version: '1.0.0' });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
});

afterAll(async () => {
  await client.close();
});

describe('what the server publishes', () => {
  it('lists all three with their arguments and which are required', async () => {
    const listed = await client.listPrompts();
    expect(listed.prompts.map((prompt) => prompt.name).sort()).toEqual(
      [...NAMES].sort()
    );
    const byName = new Map(listed.prompts.map((p) => [p.name, p]));
    expect(
      byName.get('report-from-notes')?.arguments?.map((a) => a.name)
    ).toEqual(['notes', 'client', 'title', 'blueprint']);
    expect(
      byName
        .get('report-from-notes')
        ?.arguments?.find((a) => a.name === 'notes')?.required
    ).toBe(true);
    expect(
      byName
        .get('deck-from-outline')
        ?.arguments?.find((a) => a.name === 'client')?.required
    ).toBeFalsy();
    for (const prompt of listed.prompts)
      expect(prompt.description?.length ?? 0).toBeGreaterThan(40);
  });

  it('declares the prompts capability', () => {
    const server = createServer(
      createToolDeps({ serverVersion: '0.0.0-test' })
    );
    expect(server.server.getCapabilities?.()).toMatchObject({ prompts: {} });
  });
});

describe('what they render', () => {
  it.each(NAMES)('renders %s from representative arguments', async (name) => {
    const text = await render(name);
    expect(text.length).toBeGreaterThan(200);
    // The arguments reach the message rather than being decoration.
    for (const value of Object.values(SAMPLES[name]))
      if (value !== 'docx') expect(text).toContain(value.split('\n')[0]);
    // Every one lands on the workflow the tools actually support.
    for (const tool of [
      'jto_scaffold',
      'jto_workspace_patch',
      'jto_validate',
      'jto_preview',
      'jto_critique',
      'jto_generate',
    ])
      expect(text).toContain(tool);
  });

  it('names the blueprints and themes the cores actually ship', async () => {
    const [docx, pptx] = await Promise.all([
      loadCore('docx'),
      loadCore('pptx'),
    ]);
    const report = await render('report-from-notes');
    for (const id of Object.keys(docx?.blueprints ?? {}))
      expect(report).toContain(`\`${id}\``);
    for (const theme of docx?.themeNames ?? [])
      expect(report).toContain(`\`${theme}\``);

    const deck = await render('deck-from-outline');
    for (const id of Object.keys(pptx?.blueprints ?? {}))
      expect(deck).toContain(`\`${id}\``);
    for (const theme of pptx?.themeNames ?? [])
      expect(deck).toContain(`\`${theme}\``);
  });

  it('promises only the outline transformations jto_scaffold performs', async () => {
    const deck = await render('deck-from-outline');
    expect(deck).toContain('at most four to a slide');
    expect(deck).toContain('(cont.)');
    expect(deck).toContain('evidence column');
    // Nothing about splitting charts, rewriting titles or reordering slides.
    expect(deck).not.toMatch(/reorder|rewrite the title|invents?/i);
  });

  it('points at the generated guide instead of restating the rules', async () => {
    for (const name of NAMES) {
      const text = await render(name);
      expect(text).toContain('jto://guide/design/');
      // The bar lives in the guide and the diagnostics; a prompt that starts
      // listing font counts and palette rules is a second copy that drifts.
      expect(text).not.toMatch(
        /three font families|off-palette|type scale|line length/i
      );
    }
  });
});
