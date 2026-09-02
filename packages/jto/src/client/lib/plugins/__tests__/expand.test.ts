import { describe, expect, it, vi } from 'vitest';
import {
  documentReferencesPlugins,
  expandDocument,
  PluginExpansionError,
  remapExpandedPointer,
  type PluginRenderer,
} from '../expand';

const plugins = new Map([
  ['callout', { name: 'callout', versions: ['1.0.0', '2.0.0'] }],
  ['wrapper', { name: 'wrapper', versions: ['1.0.0'] }],
]);

/** A renderer that echoes what it was given, so the walk can be asserted. */
const echo: PluginRenderer = async ({ name, version, props, children }) => ({
  components: [
    {
      name: 'paragraph',
      props: {
        text: `${name}@${version ?? 'latest'}:${JSON.stringify(props)}`,
      },
    },
    ...(children ?? []),
  ],
  warnings: [{ message: `rendered ${name}` }],
});

describe('documentReferencesPlugins', () => {
  it('finds a plugin at any depth and nothing otherwise', () => {
    const names = new Set(['callout']);
    expect(
      documentReferencesPlugins(
        {
          name: 'docx',
          children: [
            { name: 'section', children: [{ name: 'callout', props: {} }] },
          ],
        },
        names
      )
    ).toBe(true);
    expect(
      documentReferencesPlugins(
        { name: 'docx', children: [{ name: 'paragraph', props: {} }] },
        names
      )
    ).toBe(false);
    expect(documentReferencesPlugins('not a document', names)).toBe(false);
  });
});

describe('expandDocument', () => {
  it('replaces plugin nodes and expands their children first', async () => {
    const document = {
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'section',
          props: {},
          children: [
            {
              name: 'wrapper',
              props: { kind: 'box' },
              children: [{ name: 'callout', props: { title: 'Hi' } }],
            },
            { name: 'paragraph', props: { text: 'plain' } },
          ],
        },
      ],
    };
    const result = await expandDocument(document, {
      plugins,
      theme: { colors: {} },
      render: echo,
    });
    const section = (result.document as any).children[0];
    expect(section.children.map((c: any) => c.name)).toEqual([
      'paragraph', // wrapper's own output
      'paragraph', // callout's output, passed through wrapper as children
      'paragraph', // the plain paragraph
    ]);
    expect(section.children[0].props.text).toContain('wrapper@latest');
    expect(section.children[1].props.text).toContain('callout@latest');
    expect(result.warnings.map((w) => w.component)).toEqual([
      'callout',
      'wrapper',
    ]);
    // The input is never mutated.
    expect(document.children[0].children[0].name).toBe('wrapper');
  });

  it('labels warnings with the pinned version and passes it to render', async () => {
    const render = vi.fn(echo);
    const result = await expandDocument(
      {
        name: 'docx',
        children: [{ name: 'callout', version: '1.0.0', props: {} }],
      },
      { plugins, theme: {}, render }
    );
    expect(render).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'callout', version: '1.0.0' }),
      undefined
    );
    expect(result.warnings[0]).toMatchObject({
      component: 'callout@1.0.0',
      severity: 'warning',
    });
  });

  it('re-expands plugin output that names another plugin', async () => {
    const render: PluginRenderer = async ({ name }) => ({
      components:
        name === 'wrapper'
          ? [{ name: 'callout', props: { title: 'nested' } }]
          : [{ name: 'paragraph', props: { text: 'leaf' } }],
      warnings: [],
    });
    const result = await expandDocument(
      { name: 'docx', children: [{ name: 'wrapper', props: {} }] },
      { plugins, theme: {}, render }
    );
    expect((result.document as any).children).toEqual([
      { name: 'paragraph', props: { text: 'leaf' } },
    ]);
  });

  it('drops a plugin node the author disabled', async () => {
    const render = vi.fn(echo);
    const result = await expandDocument(
      {
        name: 'pptx',
        children: [{ name: 'callout', enabled: false, props: {} }],
      },
      { plugins, theme: {}, render }
    );
    expect((result.document as any).children).toEqual([]);
    expect(render).not.toHaveBeenCalled();
  });

  it('rejects a plugin node without props, an unknown version, and a bad render', async () => {
    await expect(
      expandDocument(
        { name: 'docx', children: [{ name: 'callout' }] },
        { plugins, theme: {}, render: echo }
      )
    ).rejects.toThrow(/must have a 'props' property/);

    await expect(
      expandDocument(
        {
          name: 'docx',
          children: [{ name: 'callout', version: '9.9.9', props: {} }],
        },
        { plugins, theme: {}, render: echo }
      )
    ).rejects.toThrow(
      /does not have version "9.9.9". Available versions: 1.0.0, 2.0.0/
    );

    const failing: PluginRenderer = async () => {
      throw new Error('boom');
    };
    const error = await expandDocument(
      {
        name: 'docx',
        children: [
          { name: 'section', children: [{ name: 'callout', props: {} }] },
        ],
      },
      { plugins, theme: {}, render: failing }
    ).catch((e) => e);
    expect(error).toBeInstanceOf(PluginExpansionError);
    expect(error.message).toBe(
      "Error processing custom component 'callout': boom"
    );
    // A JSON pointer, so the editor can jump to the node that failed.
    expect(error.path).toBe('/children/0/children/0');
    expect(error.pluginName).toBe('callout');

    const notArray: PluginRenderer = async () => ({
      components: { name: 'paragraph' } as never,
      warnings: [],
    });
    await expect(
      expandDocument(
        { name: 'docx', children: [{ name: 'callout', props: {} }] },
        { plugins, theme: {}, render: notArray }
      )
    ).rejects.toThrow(/must render an array/);
  });

  it('stops a self-referencing plugin at the depth cap', async () => {
    const loop: PluginRenderer = async () => ({
      components: [{ name: 'callout', props: {} }],
      warnings: [],
    });
    await expect(
      expandDocument(
        { name: 'docx', children: [{ name: 'callout', props: {} }] },
        { plugins, theme: {}, render: loop, maxDepth: 5 }
      )
    ).rejects.toThrow(/Maximum component nesting depth exceeded \(5\)/);
  });

  it('returns a document without children untouched', async () => {
    const result = await expandDocument(
      { name: 'docx', props: {} },
      { plugins, theme: {}, render: echo }
    );
    expect(result.document).toEqual({ name: 'docx', props: {} });
    expect(result.pathMap.size).toBe(0);
  });

  it('stops at the node budget', async () => {
    const wide: PluginRenderer = async () => ({
      components: Array.from({ length: 3 }, () => ({
        name: 'paragraph',
        props: {},
      })),
      warnings: [],
    });
    await expect(
      expandDocument(
        { name: 'docx', children: [{ name: 'callout', props: {} }] },
        { plugins, theme: {}, render: wide, maxNodes: 2 }
      )
    ).rejects.toThrow(/more than 2 components; stopping at 'callout'/);
  });

  it('gives up as soon as the signal is aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      expandDocument(
        { name: 'docx', children: [{ name: 'callout', props: {} }] },
        { plugins, theme: {}, render: echo, signal: controller.signal }
      )
    ).rejects.toThrow(/cancelled/);
  });

  it('warns about remote sources the plugin introduced, not ones the author wrote', async () => {
    const image: PluginRenderer = async () => ({
      components: [
        { name: 'image', props: { src: 'https://cdn.example/a.png' } },
        { name: 'image', props: { src: 'https://cdn.example/b.png' } },
      ],
      warnings: [],
    });
    const result = await expandDocument(
      {
        name: 'docx',
        children: [
          { name: 'image', props: { src: 'https://cdn.example/a.png' } },
          { name: 'callout', props: {} },
        ],
      },
      { plugins, theme: {}, render: image }
    );
    expect(result.warnings).toEqual([
      expect.objectContaining({
        component: 'callout',
        message: expect.stringContaining('https://cdn.example/b.png'),
        context: expect.objectContaining({ code: 'PLUGIN_REMOTE_SOURCE' }),
      }),
    ]);
  });
});

describe('remapExpandedPointer', () => {
  it('points expanded positions back at the authored tree', async () => {
    const result = await expandDocument(
      {
        name: 'docx',
        props: { theme: 'minimal' },
        children: [
          {
            name: 'section',
            props: {},
            children: [
              {
                name: 'wrapper',
                props: {},
                children: [{ name: 'callout', props: {} }],
              },
              { name: 'paragraph', props: { text: 'plain' } },
            ],
          },
        ],
      },
      { plugins, theme: {}, render: echo }
    );
    const { pathMap } = result;
    const remap = (pointer: string) => remapExpandedPointer(pointer, pathMap);

    // The plain paragraph moved from index 1 to index 2; a finding on it
    // goes back to where the author can fix it.
    expect(remap('/children/0/children/2/props/text')).toEqual({
      path: '/children/0/children/1/props/text',
      insidePlugin: false,
    });
    // Everything the wrapper emitted — its own paragraph and the callout's
    // output it passed through — maps to the wrapper node, as plugin output.
    expect(remap('/children/0/children/0/props/text')).toEqual({
      path: '/children/0/children/0',
      insidePlugin: true,
    });
    expect(remap('/children/0/children/1')).toEqual({
      path: '/children/0/children/0',
      insidePlugin: true,
    });
    // Paths above any plugin are unchanged.
    expect(remap('/children/0/props')).toEqual({
      path: '/children/0/props',
      insidePlugin: false,
    });
    expect(remap('/props/theme')).toEqual({
      path: '/props/theme',
      insidePlugin: false,
    });
    // Not a pointer: returned as it came.
    expect(remap('children[0]')).toEqual({
      path: 'children[0]',
      insidePlugin: false,
    });
  });
});
