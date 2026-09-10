/**
 * The three ways into the authoring workflow, as MCP prompts (#348).
 *
 * A prompt is a convenience, not a second home for the workflow. Everything
 * these render is already true of the tools; what they buy is that a person in
 * Claude Desktop can pick "report from notes" from a menu and land on the
 * first move of the design workflow instead of the generic one — which is the
 * failure this whole programme exists to remove.
 *
 * Two rules keep them from becoming a liability. They state no taste rules:
 * the bar lives in `jto://guide/design/<format>` and in what `jto_validate`
 * enforces, and a prompt restating it is a second copy that will drift. And
 * they promise nothing the tools do not do — the blueprint ids and theme names
 * are read from the cores at render time rather than written here, and the
 * outline transformations named are exactly the three `jto_scaffold` performs.
 */

import type { McpServer } from '@modelcontextprotocol/server';

import type { FormatName } from '../lib/adapters.js';
import { loadCore } from '../lib/core.js';
import type { ToolDeps } from '../lib/deps.js';
import { S } from '../lib/schema.js';

/** One rendered prompt: a single user message, which is all a host needs. */
function message(text: string) {
  return {
    messages: [
      { role: 'user' as const, content: { type: 'text' as const, text } },
    ],
  };
}

/** The blueprints a format actually ships, as a sentence naming each. */
async function blueprintsFor(format: FormatName): Promise<string> {
  const core = await loadCore(format);
  const entries = Object.values(core?.blueprints ?? {});
  if (entries.length === 0)
    return `This server ships no ${format} blueprints; decide the structure explicitly instead.`;
  return entries
    .map(
      (blueprint) =>
        `\`${blueprint.id}\` (${Object.keys(blueprint.variants).join(', ')}) — ${blueprint.whenToUse}`
    )
    .join('\n- ');
}

/** The themes a format actually ships. */
async function themesFor(format: FormatName): Promise<string> {
  const core = await loadCore(format);
  return core?.themeNames.length
    ? core.themeNames.map((name) => `\`${name}\``).join(', ')
    : 'the defaults';
}

/** The loop that follows every entry point, named in the order it is walked. */
const WORKFLOW = `Then walk the loop, and do not skip the looking:

1. FILL every pointer the fill map lists with \`jto_workspace_patch\` — RFC 6902 operations over the pointers it gave you, not a resend of the document.
2. VALIDATE with \`jto_validate\` after each edit. Repair what it reports; apply the RFC 6902 fix when a finding carries one. It says \`generationReady\` once no \`{{…}}\` marker remains.
3. LOOK with \`jto_preview\` whenever the question is visual, and with \`contactSheet: true\` to judge the document as a whole.
4. JUDGE with \`jto_critique\` \`inspect\`, then record the verdict it produced with \`jto_critique\` \`record\`. Three recorded iterate rounds is the limit.
5. SHIP with \`jto_generate\`.

Read \`jto://guide/design/<format>\` once before you start: the themes, profiles, blocks and rules in one page, generated from the same data \`jto_validate\` enforces. Do not restate design rules to yourself from memory — that page and the diagnostics are the bar.`;

export function register(server: McpServer, _deps: ToolDeps): void {
  server.registerPrompt(
    'design-brief',
    {
      title: 'Write the direction brief first',
      description:
        'Turn a vague request into the six lines a document is designed against — audience, purpose, the one thing it must land, length, tone, constraints — then pick the archetype and theme to build it with.',
      argsSchema: S<{ subject: string; audience?: string; format?: string }>({
        type: 'object',
        properties: {
          subject: {
            type: 'string',
            description: 'What the document is about, in the words you have.',
          },
          audience: {
            type: 'string',
            description: 'Who reads it, if you know yet.',
          },
          format: {
            type: 'string',
            enum: ['docx', 'pptx'],
            description: 'docx for a report, pptx for a deck. Ask if unsure.',
          },
        },
        required: ['subject'],
        additionalProperties: false,
      }),
    },
    async (args) => {
      const format = (args.format as FormatName | undefined) ?? 'docx';
      return message(
        `Before authoring anything, write the direction brief for: ${args.subject}

Six lines, no more. Each one a decision, not a description:

1. AUDIENCE — who reads this, and what they already know.${args.audience ? ` (Given: ${args.audience}.)` : ''}
2. PURPOSE — what they should do or decide after reading it.
3. THE ONE THING — the single claim the document has to land. If you cannot write it in a sentence, the document is not ready to be built.
4. LENGTH — pages or slides, as a range.
5. TONE — how it should read, in three or four words.
6. CONSTRAINTS — the client, the date, confidentiality, anything fixed.

Ask me about any line you cannot answer; do not invent facts to fill one.

Then choose, and say why in one line each:

- The archetype, from this server's ${format} blueprints:
- ${await blueprintsFor(format)}
- The theme, from ${await themesFor(format)}. \`jto_discover\` says what each looks like and when to use it.

Then open the draft with \`jto_scaffold\`, naming that blueprint, that theme, and the brief's facts. ${WORKFLOW}`
      );
    }
  );

  server.registerPrompt(
    'report-from-notes',
    {
      title: 'Turn notes into a report',
      description:
        'Take rough notes and produce a Word report through the scaffold workflow: an outline, a draft workspace on an archetype and a theme, then fill, validate, look, judge and ship.',
      argsSchema: S<{
        notes: string;
        client?: string;
        title?: string;
        blueprint?: string;
      }>({
        type: 'object',
        properties: {
          notes: {
            type: 'string',
            description:
              'The notes, however rough. Headings, bullets and half-sentences are fine.',
          },
          client: { type: 'string', description: 'Who the report is for.' },
          title: {
            type: 'string',
            description: 'The report’s title, if it is already decided.',
          },
          blueprint: {
            type: 'string',
            description:
              'A blueprint id to use. Chosen from the list in the prompt when omitted.',
          },
        },
        required: ['notes'],
        additionalProperties: false,
      }),
    },
    async (args) =>
      message(
        `Build a Word report from these notes.

NOTES
-----
${args.notes}
-----

First, restructure them as a markdown outline — do not author the document yet:

- \`# Title\` — the report's conclusion in one sentence${args.title ? ` (use: ${args.title})` : ''}.
- \`## Heading\` — one per section, in reading order.
- \`### Heading\` — sub-headings under a section.
- The paragraphs and bullets under each \`##\` — that section's body, in order.

Every fact in the outline must come from the notes. Where the notes are thin, leave the section short and ask me rather than inventing a number, a source or a date.

Then open the draft:

- ${args.blueprint ? `Use blueprint \`${args.blueprint}\`.` : `Pick the blueprint:\n- ${await blueprintsFor('docx')}`}
- Pick the theme from ${await themesFor('docx')} — \`jto_discover\` says what each looks like.
- Call \`jto_scaffold\` with that blueprint, that theme, the outline, and \`brief\` carrying what you know: title${args.client ? `, client "${args.client}"` : ', client'}, date, author, confidentiality. A brief fact fills the metadata field and the cover and running-head slot of that name; anything it does not match is reported rather than dropped.

${WORKFLOW}`
      )
  );

  server.registerPrompt(
    'deck-from-outline',
    {
      title: 'Turn an outline into a deck',
      description:
        'Take a structured outline and produce a PowerPoint deck through the scaffold workflow, letting the outline decide the slides where it can.',
      argsSchema: S<{
        outline: string;
        client?: string;
        variant?: string;
      }>({
        type: 'object',
        properties: {
          outline: {
            type: 'string',
            description:
              'The outline: `##` per message, with paragraphs, bullets and tables under it.',
          },
          client: { type: 'string', description: 'Who the deck is for.' },
          variant: {
            type: 'string',
            description:
              'A variant of the deck blueprint. Chosen in the prompt when omitted.',
          },
        },
        required: ['outline'],
        additionalProperties: false,
      }),
    },
    async (args) =>
      message(
        `Build a PowerPoint deck from this outline.

OUTLINE
-------
${args.outline}
-------

Call \`jto_scaffold\` with \`format: "pptx"\`, this outline, and \`brief\` carrying what you know${args.client ? ` — including client "${args.client}"` : ''}:

- Pick the blueprint and variant${args.variant ? ` (use variant \`${args.variant}\`)` : ''}:
- ${await blueprintsFor('pptx')}
- Pick the theme from ${await themesFor('pptx')}.

The outline decides the slides where it can, and only in these three ways:

- A section whose bullets all read \`Label: figure\` — \`Churn: 3.1%\`, \`Margin: 41 pts (+3.2)\` — becomes rows of measurements, at most four to a slide, in order.
- A section with more bullets than a slide's list holds becomes as many slides as it needs, the later ones titled "(cont.)".
- A markdown table fills the evidence column of a two-column slide, and a \`Source:\` line fills that slide's source.

Everything else maps as it reads: each \`##\` is the next content slide's title, its paragraphs that slide's body. Where the variant draws no slide of the shape a section asks for, the answer says so — read the diagnostics rather than assuming a section landed.

${WORKFLOW}`
      )
  );
}
