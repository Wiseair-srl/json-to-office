/**
 * `jto_validate` is the gate generation applies, and nothing else.
 *
 * The tool promises `ok` mirrors that gate, so the only test that can hold it
 * honest is one that runs both: validate the document, then actually render
 * it. Two directions, both of which have been proposed as "fixes" and both of
 * which are bugs — accepting a document that will not render sends the agent
 * into a failed generate it was told would work, and rejecting one that would
 * have rendered blocks a legal document on a technicality.
 *
 * The published JSON Schema at `jto://schema/{format}/document` is the third
 * party to that agreement, and it used to be the odd one out: it required
 * `props` on component nodes whose props are all optional, so the schema an
 * agent reads called invalid the documents the validator and both generators
 * accept. Both formats' registries now decide requiredness once, for the
 * schema and the deep walk together, which is what the second test below
 * asserts — on the `props` key, which is all it asserts. One gap outside that
 * question survives and the last test pins it rather than implying it away:
 * the DOCX schema narrows `section` and `text-box` children more tightly than
 * the writer does, so a nested `section` (which flattens) and a `columns`
 * inside a `text-box` (which becomes a table of cells) validate and render
 * while the published schema refuses them.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import Ajv, { type ValidateFunction } from 'ajv';

import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { Client } from '@modelcontextprotocol/client';

import { createToolDeps } from '../lib/deps.js';
import { createOutputRoot } from '../lib/output-root.js';
import { getAdapter, type FormatName } from '../lib/adapters.js';
import { formatSchemas } from '../tools/discover.js';
import { register } from '../tools/validate.js';

/**
 * A slide may omit `props` entirely — every slide prop is optional, and
 * `core-pptx` has its own test that this renders. The published schema leaves
 * `props` out of `required` on the same node, which is the agreement the
 * second test checks.
 */
const PROPLESS_SLIDES = {
  name: 'pptx',
  props: { title: 'No slide props', slideWidth: 13.333, slideHeight: 7.5 },
  children: [
    {
      name: 'slide',
      children: [{ name: 'text', props: { text: 'Title slide' } }],
    },
  ],
};

/** The same shape one level up in DOCX: a section with no props of its own. */
const PROPLESS_SECTION = {
  name: 'docx',
  props: { metadata: { title: 'Untitled' } },
  children: [
    {
      name: 'section',
      children: [{ name: 'paragraph', props: { text: 'A paragraph.' } }],
    },
  ],
};

const BROKEN_DOCX = {
  name: 'docx',
  props: {},
  children: [{ name: 'section', children: [{ name: 'paragraph' }] }],
};

/**
 * The other half of the same rule. A slide needs no props; a text component
 * does — `text` and `runs` are optional fields but one of them has to be
 * there, so `props` is where the content it exists to draw arrives.
 */
const PROPLESS_TEXT = {
  name: 'pptx',
  props: { title: 'No text props', slideWidth: 13.333, slideHeight: 7.5 },
  children: [{ name: 'slide', children: [{ name: 'text' }] }],
};

const TEXT_WITH_PROPS = {
  name: 'pptx',
  props: { title: 'Text with props', slideWidth: 13.333, slideHeight: 7.5 },
  children: [
    { name: 'slide', children: [{ name: 'text', props: { text: 'Hello' } }] },
  ],
};

/**
 * "May be omitted" is not "may be null". A written `null` is a value, and the
 * published schema types `props` as an object on every component of either
 * format — so the walk has to check the key's presence, not its truthiness, or
 * it accepts this and the schema does not.
 */
const NULL_PROPS_SLIDE = {
  name: 'pptx',
  props: { title: 'Null slide props', slideWidth: 13.333, slideHeight: 7.5 },
  children: [
    {
      name: 'slide',
      props: null,
      children: [{ name: 'text', props: { text: 'Title slide' } }],
    },
  ],
};

const NULL_PROPS_SECTION = {
  name: 'docx',
  props: { metadata: { title: 'Untitled' } },
  children: [
    {
      name: 'section',
      props: null,
      children: [{ name: 'paragraph', props: { text: 'A paragraph.' } }],
    },
  ],
};

/**
 * DOCX containers the writer nests and the published schema does not let it.
 * Both come from the corpus, both have pinned goldens: a `section` inside a
 * `section` flattens away, and a `columns` inside a `text-box` becomes a table
 * of cells inside the box's own cell. `section.allowedChildren` and
 * `text-box.allowedChildren` name neither, and widening them would make both
 * containers mutually recursive — which the narrowing pass, whose whole output
 * is inlined, cannot express. Pinned so the day it is expressible the gap is
 * visible rather than assumed closed.
 */
const NESTED_SECTION = {
  name: 'docx',
  props: { metadata: { title: 'Nested' } },
  children: [
    {
      name: 'section',
      children: [
        { name: 'paragraph', props: { text: 'Outer.' } },
        {
          name: 'section',
          children: [{ name: 'paragraph', props: { text: 'Inner.' } }],
        },
      ],
    },
  ],
};

const NESTED_COLUMNS_IN_TEXT_BOX = {
  name: 'docx',
  props: { metadata: { title: 'Nested' } },
  children: [
    {
      name: 'section',
      children: [
        {
          name: 'text-box',
          children: [
            {
              name: 'columns',
              props: { columns: 2 },
              children: [
                { name: 'paragraph', props: { text: 'Left.' } },
                { name: 'paragraph', props: { text: 'Right.' } },
              ],
            },
          ],
        },
      ],
    },
  ],
};

let scratch: string;
let client: Client;

async function connect(): Promise<Client> {
  const deps = createToolDeps({
    outputRoot: createOutputRoot({ flagDir: path.join(scratch, 'out') }),
    serverVersion: '9.9.9-test',
  });
  const server = new McpServer(
    { name: 'json-to-office', version: '9.9.9-test' },
    { capabilities: { tools: {} } }
  );
  register(server, deps);

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const connected = new Client({ name: 'test-client', version: '1.0.0' });
  await Promise.all([
    server.connect(serverTransport),
    connected.connect(clientTransport),
  ]);
  return connected;
}

async function validate(
  format: FormatName,
  document: unknown
): Promise<Record<string, any>> {
  const called = await client.callTool({
    name: 'jto_validate',
    arguments: { format, document },
  });
  return called.structuredContent as Record<string, any>;
}

/**
 * Does the schema this server publishes accept it?
 *
 * Compiled once per format: Ajv refuses a second schema under the same `$id`,
 * and the generated document schema names one.
 */
const compiled = new Map<FormatName, ValidateFunction>();
function publishedSchemaAccepts(
  format: FormatName,
  document: unknown
): boolean {
  let validateSchema = compiled.get(format);
  if (!validateSchema) {
    // Compiled as published, `$schema` included: a stock Ajv resolving the
    // declared dialect is part of what the published schema promises.
    validateSchema = new Ajv({
      strict: false,
      allErrors: true,
      validateFormats: false,
    }).compile(formatSchemas(format).document);
    compiled.set(format, validateSchema);
  }
  return validateSchema(document) === true;
}

/** Does generation actually accept it? The one authority `ok` answers for. */
async function renders(
  format: FormatName,
  document: unknown
): Promise<boolean> {
  try {
    const buffer = await getAdapter(format).generateBuffer(document, {});
    return buffer.length > 0;
  } catch {
    return false;
  }
}

beforeEach(async () => {
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'jto-mcp-gate-'));
  client = await connect();
});

afterEach(async () => {
  await client.close();
  await fs.rm(scratch, { recursive: true, force: true });
});

describe('jto_validate mirrors the generation gate', () => {
  it('agrees with the renderer on every document, both ways', async () => {
    const cases: Array<[string, FormatName, unknown]> = [
      ['propless slides', 'pptx', PROPLESS_SLIDES],
      ['propless section', 'docx', PROPLESS_SECTION],
      ['paragraph with no text', 'docx', BROKEN_DOCX],
      ['text with no props', 'pptx', PROPLESS_TEXT],
      [
        'unknown component',
        'pptx',
        {
          name: 'pptx',
          props: {},
          children: [{ name: 'not-a-component', props: {} }],
        },
      ],
    ];

    const disagreed: string[] = [];
    for (const [label, format, document] of cases) {
      const verdict = await validate(format, document);
      const generated = await renders(format, document);
      if (verdict.ok !== generated) {
        disagreed.push(
          `${label}: jto_validate ok=${verdict.ok}, generation ok=${generated}`
        );
      }
    }
    expect(disagreed, disagreed.join('\n')).toEqual([]);
  }, 60_000);

  it('asks for the same props the schema it publishes asks for', async () => {
    // Both directions, on the two components the rule differs for: a document
    // `jto_validate` accepts must satisfy `jto://schema/{f}/document`, and one
    // that schema accepts must pass `jto_validate`. Either way round, an agent
    // that reads the schema and an agent that calls the tool have to be able
    // to write the same document.
    const cases: Array<[string, FormatName, unknown, boolean]> = [
      ['propless slide', 'pptx', PROPLESS_SLIDES, true],
      ['propless section', 'docx', PROPLESS_SECTION, true],
      ['propless text', 'pptx', PROPLESS_TEXT, false],
      ['text with props', 'pptx', TEXT_WITH_PROPS, true],
      // The key written as `null`, on the very components the omission is
      // legal for. Both formats, because both walks read presence the same way.
      ['null slide props', 'pptx', NULL_PROPS_SLIDE, false],
      ['null section props', 'docx', NULL_PROPS_SECTION, false],
    ];

    const disagreed: string[] = [];
    for (const [label, format, document, accepted] of cases) {
      const verdict = await validate(format, document);
      const published = publishedSchemaAccepts(format, document);
      if (verdict.ok !== accepted || published !== accepted) {
        disagreed.push(
          `${label}: expected both to ${accepted ? 'accept' : 'reject'}, got jto_validate ok=${verdict.ok}, published schema ok=${published}`
        );
      }
    }
    expect(disagreed, disagreed.join('\n')).toEqual([]);
  });

  it('reports a missing props as a located E_REQUIRED_PROPERTY', async () => {
    // The repair an agent can act on: one diagnostic, a code from this
    // server's vocabulary rather than a TypeBox ordinal, and a JSON Pointer
    // it can hand straight to jto_workspace_patch.
    expect(await validate('pptx', PROPLESS_TEXT)).toMatchObject({
      ok: false,
      valid: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'E_REQUIRED_PROPERTY',
          path: '/children/0/children/0/props',
        },
      ],
    });
  });

  it('publishes a schema a stock validator can compile as published', async () => {
    // `$schema` names draft-07 by its own `$id`, the http:// spelling every
    // validator keys its bundled meta-schema under. The https:// spelling read
    // as an unknown dialect, so a consumer had to strip the field first — and
    // the two tests in this package that compile the schema did exactly that,
    // which is how the ergonomic defect stayed invisible.
    for (const format of ['docx', 'pptx'] as const) {
      const schema = formatSchemas(format).document;
      expect(schema.$schema).toBe('http://json-schema.org/draft-07/schema#');
      // `validateFormats: false` only silences the format vocabulary an Ajv
      // without ajv-formats does not carry; the dialect still has to resolve.
      expect(() =>
        new Ajv({ strict: false, validateFormats: false }).compile(schema)
      ).not.toThrow();
    }
  });

  it('pins the DOCX containers the schema narrows tighter than the writer', async () => {
    // Not a props question and not closed by the requiredness fix: the
    // published schema is stricter here than `jto_validate` and the writer,
    // which is the one direction still open. Asserted rather than described so
    // widening `allowedChildren` (or narrowing the walk) reddens this test.
    const gaps: Array<[string, unknown]> = [
      ['nested section', NESTED_SECTION],
      ['columns in a text-box', NESTED_COLUMNS_IN_TEXT_BOX],
    ];
    const unexpected: string[] = [];
    for (const [label, document] of gaps) {
      const verdict = await validate('docx', document);
      const generated = await renders('docx', document);
      const published = publishedSchemaAccepts('docx', document);
      if (verdict.ok !== true || generated !== true || published !== false) {
        unexpected.push(
          `${label}: jto_validate ok=${verdict.ok}, generation ok=${generated}, published schema ok=${published} (expected true/true/false)`
        );
      }
    }
    expect(unexpected, unexpected.join('\n')).toEqual([]);
  }, 60_000);
});
