/**
 * #202's headline acceptance, over a real stdio transport.
 *
 * "A zero-context agent can discover, author, validate and generate both
 * formats" is a claim about what the server TELLS a client, so this suite is
 * written to know as little as it can get away with: no component names, no
 * prop names, no document literals. Every value it acts on came out of
 * `jto_info`, `jto_discover`, `jto_describe_component` or a diagnostic, in the
 * order an agent would meet them.
 *
 * The one exception is the two format names in test titles, and even those are
 * checked against what the server advertises rather than assumed.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs/promises';

import {
  callTool,
  firstStringProp,
  openSession,
  parentDirOf,
  pointerGet,
  pointerSet,
  realRoot,
  ZIP_MAGIC,
  type StdioSession,
  type ToolEnvelope,
} from './fixtures/stdio-harness.js';

const CONNECT_TIMEOUT_MS = 120_000;
const GENERATION_TIMEOUT_MS = 120_000;

interface FormatInfo {
  name: string;
  extension: string;
  rendererIds: string[];
}

interface Starter {
  id: string;
  format: string;
  title: string;
  document: Record<string, unknown>;
}

interface CatalogFormat {
  name: string;
  extension: string;
  rootComponent: string;
  defaultRenderer: string;
  renderers: Array<{ id: string; default: boolean; components: string[] }>;
  components: Array<{ name: string; hasChildren: boolean; root: boolean }>;
  themes: string[];
  starters: Starter[];
}

let session: StdioSession;
let info: ToolEnvelope & { formats: FormatInfo[]; output: { root: string } };
let catalog: CatalogFormat[];

beforeAll(async () => {
  session = await openSession();
}, CONNECT_TIMEOUT_MS);

afterAll(async () => {
  await session?.close();
});

describe('what the server tells a client that knows nothing', () => {
  it('answers jto_info with the formats it can author and where files land', async () => {
    info = (await callTool(session, 'jto_info', {})) as typeof info;

    expect(info.ok).toBe(true);
    expect(info.formats.length).toBeGreaterThan(0);
    for (const format of info.formats) {
      expect(format.extension).toMatch(/^\.[a-z]+$/);
      expect(format.rendererIds.length).toBeGreaterThan(0);
    }
    // The path half of the artifact contract: an agent has to be able to
    // predict where a generated file will be before it asks for one.
    expect(info.output.root).toBe(session.outputRoot);
  });

  it('answers jto_discover with a root component and a starter per format', async () => {
    const discovered = await callTool(session, 'jto_discover', {});
    expect(discovered.ok).toBe(true);
    catalog = discovered.formats as CatalogFormat[];

    expect(catalog.map((format) => format.name).sort()).toEqual(
      info.formats.map((format) => format.name).sort()
    );

    for (const format of catalog) {
      expect(
        format.components.some(
          (component) => component.name === format.rootComponent
        ),
        `${format.name} does not list its own root component`
      ).toBe(true);
      expect(format.starters.length).toBeGreaterThan(0);
      expect(format.themes.length).toBeGreaterThan(0);
      expect(format.renderers.some((renderer) => renderer.default)).toBe(true);
    }
  });

  it(
    'answers jto_describe_component for every component a starter uses',
    async () => {
      // Not a spot check: an agent copying a starter will look up whatever is in
      // it, and a name in the catalogue that describe cannot resolve is a dead
      // end at exactly the moment the agent needs an answer.
      for (const format of catalog) {
        const used = new Set<string>();
        const collect = (node: any): void => {
          if (Array.isArray(node)) return node.forEach(collect);
          if (node === null || typeof node !== 'object') return;
          if (typeof node.name === 'string') used.add(node.name);
          if (Array.isArray(node.children)) node.children.forEach(collect);
        };
        for (const starter of format.starters) collect(starter.document);

        for (const name of used) {
          const described = await callTool(session, 'jto_describe_component', {
            format: format.name,
            name,
          });
          expect(described.ok, `${format.name}/${name} is undescribable`).toBe(
            true
          );
          const component = described.component as {
            name: string;
            hasChildren: boolean;
          };
          expect(component.name).toBe(name);
          expect(described.schema).toBeTypeOf('object');
          if (component.hasChildren) {
            expect(Array.isArray(described.allowedChildren)).toBe(true);
          }
        }
      }
    },
    GENERATION_TIMEOUT_MS
  );
});

describe('breaking a document the server supplied, and repairing it', () => {
  it('reports a defect as a normal result with a pointer that locates it', async () => {
    for (const format of catalog) {
      const starter = format.starters[0];
      const target = firstStringProp(starter.document);
      expect(target, `${starter.id} has no string prop to break`).toBeDefined();

      const broken = structuredClone(starter.document);
      // An object where the schema wants a string: a defect no renderer could
      // paper over, and one whose location is unambiguous.
      pointerSet(broken, target!.pointer, {});

      const raw = await session.client.callTool({
        name: 'jto_validate',
        arguments: { format: format.name, document: broken },
      });

      // #204: a document defect is a RESULT. Not a JSON-RPC error, not isError.
      expect(raw.isError).toBeFalsy();
      const result = raw.structuredContent as unknown as ToolEnvelope;
      expect(result.ok).toBe(false);
      expect(result.valid).toBe(false);
      expect(result.source).toEqual({ origin: 'inline' });

      const located = result.diagnostics.filter(
        (diagnostic) => diagnostic.path === target!.pointer
      );
      expect(
        located.length,
        `no diagnostic pointed at ${target!.pointer}; got ${JSON.stringify(
          result.diagnostics
        )}`
      ).toBeGreaterThan(0);
      for (const diagnostic of located) {
        expect(diagnostic.severity).toBe('error');
        expect(diagnostic.code).toBeTypeOf('string');
        expect(diagnostic.code.length).toBeGreaterThan(0);
      }
    }
  });

  it('accepts the document again once the diagnostic path is repaired', async () => {
    for (const format of catalog) {
      const starter = format.starters[0];
      const target = firstStringProp(starter.document)!;

      const document = structuredClone(starter.document);
      pointerSet(document, target.pointer, {});

      const broken = await callTool(session, 'jto_validate', {
        format: format.name,
        document,
      });
      expect(broken.ok).toBe(false);

      // The repair uses the pointer the SERVER handed back, not the one the
      // test broke — that equivalence is the whole promise of "path-addressed".
      const pointer = broken.diagnostics.find(
        (diagnostic) => diagnostic.path !== undefined
      )!.path!;
      pointerSet(document, pointer, target.value);
      expect(pointerGet(document, target.pointer)).toBe(target.value);

      const repaired = await callTool(session, 'jto_validate', {
        format: format.name,
        document,
      });
      expect(
        repaired.ok,
        `${starter.id} still invalid after repair: ${JSON.stringify(
          repaired.diagnostics
        )}`
      ).toBe(true);
      expect(repaired.counts).toMatchObject({ error: 0 });
    }
  });
});

describe('generating', () => {
  /**
   * KNOWN RED, and deliberately so: both `pptx` starters crash the renderer.
   *
   * Their slides carry no `props`, `jto_describe_component` says `slide`
   * requires one, `jto_validate` accepts the omission anyway, and `core-pptx`
   * reads `child.props.placeholders` unguarded — so the documents this server
   * hands a zero-context agent as "the smallest valid .pptx" cannot be
   * rendered. Reproducible with nothing but `core-pptx`'s own
   * `generateBufferFromJson`, so the defect is upstream of MCP; the bisect
   * below names which of the three links to pull on.
   *
   * Left failing rather than narrowed to docx: this IS #202's headline
   * acceptance ("generate both formats"), and a suite that skipped the half
   * that does not work would report the epic as done.
   *
   * One test for both formats for the same reason — a split would let the
   * docx half stay green while the claim was untrue. Outcomes are collected
   * rather than asserted in the loop so a failure names every format at once.
   */
  it(
    'renders every advertised starter to a real file under the output root',
    async () => {
      const outcomes: string[] = [];

      for (const format of catalog) {
        const extension = info.formats.find(
          (entry) => entry.name === format.name
        )!.extension;

        for (const starter of format.starters) {
          const filename = `${starter.id}${extension}`;
          const generated = await callTool(session, 'jto_generate', {
            format: format.name,
            document: starter.document,
            filename,
            deterministic: true,
          });

          if (!generated.ok) {
            // Codes and messages only: an `E_INTERNAL` carries the whole stack in
            // `context`, and burying the list of broken starters under four of
            // those makes the failure unreadable.
            outcomes.push(
              `${starter.id}: ${generated.diagnostics
                .map((entry) => `${entry.code} ${entry.message}`)
                .join('; ')}`
            );
            continue;
          }

          const artifact = generated.artifact as {
            mode: string;
            path: string;
            relative: string;
            bytes: number;
          };
          expect(artifact.mode).toBe('path');
          expect(artifact.relative).toBe(filename);
          // The output-root contract of #204, checked against the filesystem
          // rather than against the string the server chose to report.
          expect(await parentDirOf(artifact.path)).toBe(
            await realRoot(session.outputRoot)
          );

          const bytes = await fs.readFile(artifact.path);
          expect(bytes.length).toBe(artifact.bytes);
          expect(
            bytes.subarray(0, 4).equals(ZIP_MAGIC),
            `${filename} is not an OOXML package`
          ).toBe(true);
        }
      }

      expect(
        outcomes,
        `starters that would not render:\n${outcomes.join('\n')}`
      ).toEqual([]);
    },
    GENERATION_TIMEOUT_MS
  );

  /**
   * The same starters, with every `props` their own described schema demands.
   *
   * Deliberately a bisect rather than another smoke test. When the plain
   * starters fail and these pass, the difference is exactly the props the
   * catalogue says are required and the starters omit — which localizes the
   * defect without anybody having to read a stack trace.
   */
  it(
    'renders those starters once every required `props` is present',
    async () => {
      for (const format of catalog) {
        const extension = info.formats.find(
          (entry) => entry.name === format.name
        )!.extension;
        const requiredKeys = new Map<string, string[]>();
        for (const component of format.components) {
          // The catalogue lists every component any renderer draws, so a
          // renderer-scoped one (the docx `chart`) has no schema under the
          // default backend. Describe each under a renderer that has it.
          const described = await callTool(session, 'jto_describe_component', {
            format: format.name,
            name: component.name,
            ...(component.renderers?.length
              ? { renderer: component.renderers[0] }
              : {}),
          });
          requiredKeys.set(
            component.name,
            ((described.schema as any).required as string[] | undefined) ?? []
          );
        }

        for (const starter of format.starters) {
          const document = structuredClone(starter.document);
          const filled: string[] = [];
          const fill = (node: any, pointer: string): void => {
            if (Array.isArray(node)) {
              node.forEach((entry, index) =>
                fill(entry, `${pointer}/${index}`)
              );
              return;
            }
            if (node === null || typeof node !== 'object') return;
            if (
              typeof node.name === 'string' &&
              requiredKeys.get(node.name)?.includes('props') === true &&
              node.props === undefined
            ) {
              filled.push(`${pointer} (${node.name})`);
              node.props = {};
            }
            if (Array.isArray(node.children))
              fill(node.children, `${pointer}/children`);
          };
          fill(document, '');

          const generated = await callTool(session, 'jto_generate', {
            format: format.name,
            document,
            filename: `filled-${starter.id}${extension}`,
          });
          expect(
            generated.ok,
            `${starter.id} would not render even after filling ${JSON.stringify(
              filled
            )}: ${JSON.stringify(generated.diagnostics)}`
          ).toBe(true);
        }
      }
    },
    GENERATION_TIMEOUT_MS
  );
});
