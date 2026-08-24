/**
 * `jto_describe_component`. The two things worth proving are that the schema
 * is the real branch (not a summary of one) and that it stays small enough to
 * read — the whole point of having this tool instead of the schema resource.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { InMemoryTransport } from '@modelcontextprotocol/server';
import { Client } from '@modelcontextprotocol/client';

import { createServer } from '../server.js';
import { createToolDeps } from '../lib/deps.js';

let client: Client;

interface DescribeResult {
  ok: boolean;
  diagnostics: Array<{ code: string; message: string; suggestion?: string }>;
  component?: {
    format: string;
    name: string;
    category?: string;
    description?: string;
    hasChildren: boolean;
    root: boolean;
    stability?: string;
  };
  renderer?: string;
  renderers?: Array<{ id: string; default: boolean; supported: boolean }>;
  schema?: Record<string, any>;
  definitions?: Record<string, unknown>;
  elided?: Array<{
    pointer: string;
    prop: string;
    bytes: number;
    hint: string;
  }>;
  allowedChildren?: string[];
  allowedParents?: string[];
}

async function describeComponent(args: Record<string, unknown>) {
  const result = await client.callTool({
    name: 'jto_describe_component',
    arguments: args,
  });
  return result.structuredContent as unknown as DescribeResult;
}

/** Every `$ref` the returned schema still contains. */
function refsIn(node: unknown, found: Set<string> = new Set()): Set<string> {
  if (Array.isArray(node)) {
    node.forEach((entry) => refsIn(entry, found));
    return found;
  }
  if (typeof node !== 'object' || node === null) return found;
  for (const [key, value] of Object.entries(node)) {
    if (key === '$ref' && typeof value === 'string') found.add(value);
    else refsIn(value, found);
  }
  return found;
}

beforeAll(async () => {
  const server = createServer(createToolDeps({ serverVersion: '9.9.9-test' }));
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test-client', version: '1.0.0' });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
});

afterAll(async () => {
  await client.close();
});

describe('jto_describe_component', () => {
  it('returns the branch the validator dispatches on', async () => {
    const result = await describeComponent({
      format: 'docx',
      name: 'paragraph',
    });
    expect(result.ok).toBe(true);
    expect(result.component).toMatchObject({
      format: 'docx',
      name: 'paragraph',
      category: 'content',
      hasChildren: false,
      root: false,
    });
    expect(result.renderer).toBe('docxjs');
    expect(result.schema?.properties?.name?.const).toBe('paragraph');
    // Not a paraphrase: the real props schema is there, with its own fields.
    expect(
      Object.keys(result.schema?.properties?.props?.properties ?? {})
    ).toContain('text');
    expect(result.allowedParents).toEqual(
      expect.arrayContaining(['section', 'columns'])
    );
  });

  it('collapses nested components instead of inlining their schemas', async () => {
    const result = await describeComponent({ format: 'docx', name: 'section' });
    expect(result.ok).toBe(true);
    expect(result.component?.hasChildren).toBe(true);
    expect(result.allowedChildren).toEqual(
      expect.arrayContaining(['heading', 'paragraph', 'table'])
    );

    const items = result.schema?.properties?.children?.items;
    expect(items?.properties?.name?.enum).toEqual(result.allowedChildren);
    expect(items?.description).toContain('jto_describe_component');

    // Inlined, this branch is 226 KB of its descendants' schemas.
    expect(JSON.stringify(result.schema).length).toBeLessThan(16 * 1024);
  });

  it('elides props that are whole documents, and hands them back on request', async () => {
    const lean = await describeComponent({ format: 'docx', name: 'docx' });
    expect(lean.ok).toBe(true);
    expect(lean.component?.root).toBe(true);
    const elidedProps = (lean.elided ?? []).map((entry) => entry.prop);
    expect(elidedProps).toContain('themeOverrides');
    expect(lean.elided?.[0]?.hint).toContain('expandProps');
    expect(
      lean.schema?.properties?.props?.properties?.themeOverrides?.$comment
    ).toMatch(/^Elided: \d+ bytes\.$/);
    expect(JSON.stringify(lean.schema).length).toBeLessThan(64 * 1024);

    const expanded = await describeComponent({
      format: 'docx',
      name: 'docx',
      expandProps: ['themeOverrides'],
    });
    expect((expanded.elided ?? []).map((entry) => entry.prop)).not.toContain(
      'themeOverrides'
    );
    expect(
      Object.keys(
        expanded.schema?.properties?.props?.properties?.themeOverrides
          ?.properties ?? {}
      ).length
    ).toBeGreaterThan(0);
  });

  it('ships the definitions its own $refs need', async () => {
    const result = await describeComponent({ format: 'docx', name: 'visual' });
    expect(result.ok).toBe(true);
    const available = new Set(Object.keys(result.definitions ?? {}));
    for (const ref of refsIn(result.schema)) {
      const name = /^#\/definitions\/(.+)$/.exec(ref)?.[1];
      expect(name, `unresolvable ${ref}`).toBeDefined();
      expect(available, `dangling ${ref}`).toContain(name);
    }
    for (const [key, definition] of Object.entries(result.definitions ?? {})) {
      for (const ref of refsIn(definition)) {
        const name = /^#\/definitions\/(.+)$/.exec(ref)?.[1];
        expect(available, `${key} references dangling ${ref}`).toContain(name);
      }
    }
  });

  it('answers per renderer profile, not per format', async () => {
    const docxjs = await describeComponent({
      format: 'docx',
      name: 'visual',
      renderer: 'docxjs',
    });
    const officeOpen = await describeComponent({
      format: 'docx',
      name: 'visual',
      renderer: 'office-open',
    });
    expect(docxjs.renderer).toBe('docxjs');
    expect(officeOpen.renderer).toBe('office-open');
    // Only `office-open` draws a native visual, so the two profiles must not
    // hand back the same props schema.
    expect(JSON.stringify(docxjs.schema)).not.toEqual(
      JSON.stringify(officeOpen.schema)
    );
    expect(docxjs.renderers).toEqual([
      { id: 'docxjs', default: true, supported: true },
      { id: 'office-open', default: false, supported: true },
    ]);
  });

  it('says which renderer supports a component the asked-for one does not', async () => {
    // Asked of docx rather than pptx: the pptx pair no longer disagrees about
    // any component, while docx.js still has no chart primitive.
    const result = await describeComponent({
      format: 'docx',
      name: 'chart',
      renderer: 'docxjs',
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('E_UNKNOWN_COMPONENT');
    expect(result.diagnostics[0]?.suggestion).toContain('office-open');
  });

  it('names the alternatives when a component does not exist', async () => {
    const result = await describeComponent({
      format: 'docx',
      name: 'paragrpah',
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('E_UNKNOWN_COMPONENT');
    expect(result.diagnostics[0]?.suggestion).toContain('paragraph');
  });

  it('rejects an unknown renderer with the list of real ones', async () => {
    const result = await describeComponent({
      format: 'docx',
      name: 'paragraph',
      renderer: 'latex',
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('E_UNKNOWN_RENDERER');
    expect(result.diagnostics[0]?.suggestion).toContain('docxjs');
  });

  it('reports a missing component as a result, never a protocol error', async () => {
    const raw = await client.callTool({
      name: 'jto_describe_component',
      arguments: { format: 'docx', name: 'nope' },
    });
    expect(raw.isError).toBeFalsy();
    expect((raw.structuredContent as { ok?: boolean }).ok).toBe(false);
  });

  /**
   * The one cross-format edge in the registry: a DOCX `visual` carries a pptx
   * slide in `props.elements`. Following the collapsed child's hint with the
   * format in hand used to dead-end on E_UNKNOWN_COMPONENT, and `visual` is the
   * only way to get a chart into a Word document with no external service.
   */
  describe('the docx visual → pptx edge', () => {
    it('names the format the nested components actually belong to', async () => {
      const visual = await describeComponent({
        format: 'docx',
        name: 'visual',
      });
      const elements = (visual.definitions?.DocxVisualRasterProps as any)
        ?.properties?.elements;

      expect(elements.items.properties.name.enum).toContain('chart');
      expect(elements.items.description).toContain(
        'jto_describe_component with format "pptx"'
      );
    });

    it('points at the other format instead of dead-ending', async () => {
      // `shape` rather than `chart`: docx has a native `chart` of its own now,
      // so it is no longer a name only the other format knows.
      const result = await describeComponent({ format: 'docx', name: 'shape' });
      expect(result.ok).toBe(false);
      expect(result.diagnostics[0]?.code).toBe('E_UNKNOWN_COMPONENT');
      expect(result.diagnostics[0]?.suggestion).toContain(
        'pass format: "pptx"'
      );
    });

    it("describes the docx chart as office-open's own component", async () => {
      const result = await describeComponent({
        format: 'docx',
        name: 'chart',
        renderer: 'office-open',
      });
      expect(result.ok).toBe(true);
      expect(result.renderers).toEqual([
        { id: 'docxjs', default: true, supported: false },
        { id: 'office-open', default: false, supported: true },
      ]);
    });

    it('still just lists the known names for a plain typo', async () => {
      const result = await describeComponent({
        format: 'docx',
        name: 'paragrpah',
      });
      expect(result.diagnostics[0]?.suggestion).not.toContain('pass format');
    });

    it('leaves a same-format union pointing at its own format', async () => {
      const section = await describeComponent({
        format: 'docx',
        name: 'section',
      });
      const children = section.schema?.properties?.children;
      expect(children.items.description).toContain(
        'jto_describe_component with format "docx"'
      );
    });
  });

  /**
   * `chart` was the one positionable pptx component whose bare number carried
   * no unit, on exactly the component an agent reaches for when asked for a
   * deck about a quarter's numbers.
   */
  describe('pptx chart', () => {
    it('documents x/y/w/h in the same units as its siblings', async () => {
      const chart = await describeComponent({ format: 'pptx', name: 'chart' });
      const props = chart.schema?.properties?.props?.properties;

      for (const [axis, unit] of [
        ['x', 'X position in inches'],
        ['y', 'Y position in inches'],
        ['w', 'Width in inches'],
        ['h', 'Height in inches'],
      ] as const) {
        const branches = props[axis].anyOf as Array<Record<string, unknown>>;
        const numeric = branches.find((branch) => branch.type === 'number');
        expect(numeric?.description, axis).toBe(unit);
      }
    });

    // The compiler drops the whole chart when any series is missing either, and
    // the schema used to say only "optional" — so an agent had to discover the
    // rule from a rendered file with no chart in it.
    it('says labels and values are needed on every series', async () => {
      const chart = await describeComponent({ format: 'pptx', name: 'chart' });
      const series = chart.schema?.properties?.props?.properties?.data?.items;

      expect(series.properties.labels.description).toContain('every series');
      expect(series.properties.labels.description).toContain(
        'drops the whole chart'
      );
      expect(series.properties.values.description).toContain('every series');
    });
  });
});
