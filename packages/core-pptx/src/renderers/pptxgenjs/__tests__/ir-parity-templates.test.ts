/**
 * Template, placeholder and advanced-fill parity between the legacy pipeline
 * and the IR pipeline.
 *
 * Split from `ir-parity.test.ts` so the vertical-slice cases stay readable;
 * the comparison harness is the same and the bar is the same — identical
 * package parts.
 */

import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { createHash } from 'node:crypto';
import { generateBufferFromJson } from '../../../core/generator';
import { generateBufferViaIr } from '../../../core/generateFromIr';
import type { PresentationComponentDefinition } from '../../../types';

async function entries(buffer: Buffer): Promise<Map<string, string>> {
  const zip = await JSZip.loadAsync(buffer);
  const out = new Map<string, string>();
  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    out.set(
      path,
      path.endsWith('.xml') || path.endsWith('.rels')
        ? await entry.async('string')
        : `sha256:${createHash('sha256')
            .update(await entry.async('nodebuffer'))
            .digest('hex')}`
    );
  }
  return out;
}

async function expectSamePackage(
  document: PresentationComponentDefinition
): Promise<void> {
  const legacy = (await generateBufferFromJson(
    structuredClone(document) as never
  )) as Buffer;
  const { buffer: ir } = await generateBufferViaIr(
    structuredClone(document) as never
  );

  const legacyEntries = await entries(legacy);
  const irEntries = await entries(ir);

  expect([...irEntries.keys()].sort()).toEqual(
    [...legacyEntries.keys()].sort()
  );
  for (const [path, legacyValue] of legacyEntries) {
    expect({ path, xml: irEntries.get(path) }).toEqual({
      path,
      xml: legacyValue,
    });
  }
}

const deck = (
  children: unknown[],
  props: Record<string, unknown> = {}
): PresentationComponentDefinition =>
  ({
    name: 'pptx',
    props: { title: 'Templates', ...props },
    children,
  }) as PresentationComponentDefinition;

const slide = (
  children: unknown[],
  props: Record<string, unknown> = {}
): unknown => ({ name: 'slide', props, children });

describe('template and placeholder parity', () => {
  it('matches for a template with a solid background', async () => {
    await expectSamePackage(
      deck(
        [
          slide([{ name: 'text', props: { text: 'On template' } }], {
            template: 'base',
          }),
        ],
        {
          templates: [{ name: 'base', background: { color: 'primary' } }],
        }
      )
    );
  });

  it('matches for a template with fixed objects', async () => {
    await expectSamePackage(
      deck(
        [
          slide([{ name: 'text', props: { text: 'Content', y: 3 } }], {
            template: 'base',
          }),
        ],
        {
          templates: [
            {
              name: 'base',
              objects: [
                {
                  name: 'shape',
                  props: {
                    type: 'rect',
                    x: 0,
                    y: 0,
                    w: 10,
                    h: 0.6,
                    fill: { color: 'secondary' },
                  },
                },
                {
                  name: 'text',
                  props: { text: 'Header', x: 0.3, y: 0.1, w: 5, h: 0.4 },
                },
              ],
            },
          ],
        }
      )
    );
  });

  it('matches for a template slide-number field', async () => {
    await expectSamePackage(
      deck(
        [slide([{ name: 'text', props: { text: 'x' } }], { template: 'base' })],
        {
          templates: [
            {
              name: 'base',
              slideNumber: {
                x: 9,
                y: 7,
                w: 0.7,
                h: 0.3,
                color: 'text',
                fontSize: 10,
              },
            },
          ],
        }
      )
    );
  });

  it('matches for placeholder content merged with its declaration', async () => {
    await expectSamePackage(
      deck(
        [
          slide([], {
            template: 'base',
            placeholders: {
              title: { name: 'text', props: { text: 'Filled title' } },
            },
          }),
        ],
        {
          templates: [
            {
              name: 'base',
              placeholders: [
                {
                  name: 'title',
                  x: 0.5,
                  y: 0.5,
                  w: 8,
                  h: 1,
                  defaults: {
                    name: 'text',
                    props: { fontSize: 32, color: 'primary', align: 'center' },
                  },
                },
              ],
            },
          ],
        }
      )
    );
  });

  it('matches when a placeholder overrides its declared defaults', async () => {
    await expectSamePackage(
      deck(
        [
          slide([], {
            template: 'base',
            placeholders: {
              body: {
                name: 'text',
                props: { text: 'Override', fontSize: 14, x: 2 },
              },
            },
          }),
        ],
        {
          templates: [
            {
              name: 'base',
              placeholders: [
                {
                  name: 'body',
                  x: 1,
                  y: 2,
                  w: 6,
                  h: 2,
                  defaults: { name: 'text', props: { fontSize: 20 } },
                },
              ],
            },
          ],
        }
      )
    );
  });

  it('matches for an unknown placeholder (both skip it and warn)', async () => {
    await expectSamePackage(
      deck(
        [
          slide([], {
            template: 'base',
            placeholders: { ghost: { name: 'text', props: { text: 'x' } } },
          }),
        ],
        { templates: [{ name: 'base', placeholders: [] }] }
      )
    );
  });

  it('matches for an unknown template name', async () => {
    await expectSamePackage(
      deck(
        [slide([{ name: 'text', props: { text: 'x' } }], { template: 'nope' })],
        {
          templates: [{ name: 'base' }],
        }
      )
    );
  });

  it('matches for a template grid overriding the deck grid', async () => {
    await expectSamePackage(
      deck(
        [
          slide(
            [
              {
                name: 'text',
                props: { text: 'Grid', grid: { column: 1, row: 1 } },
              },
            ],
            { template: 'base' }
          ),
        ],
        {
          grid: { columns: 12, rows: 6, margin: 0.5, gutter: 0.2 },
          templates: [
            { name: 'base', grid: { columns: 6, rows: 3, margin: 0.25 } },
          ],
        }
      )
    );
  });

  it('matches for a placeholder with no template and its own position', async () => {
    await expectSamePackage(
      deck([
        slide([], {
          placeholders: {
            free: { name: 'text', props: { text: 'free', x: 1, y: 1, w: 3 } },
          },
        }),
      ])
    );
  });
});

describe('gradient and pattern fill parity', () => {
  it('matches for a linear gradient shape fill', async () => {
    await expectSamePackage(
      deck([
        slide([
          {
            name: 'shape',
            props: {
              type: 'rect',
              x: 1,
              y: 1,
              w: 5,
              h: 3,
              fill: {
                gradient: {
                  type: 'linear',
                  angle: 45,
                  stops: [
                    { color: 'primary', pos: 0 },
                    { color: 'accent', pos: 100, transparency: 25 },
                  ],
                },
              },
            },
          },
        ]),
      ])
    );
  });

  it('matches for a radial gradient shape fill', async () => {
    await expectSamePackage(
      deck([
        slide([
          {
            name: 'shape',
            props: {
              type: 'ellipse',
              x: 1,
              y: 1,
              w: 4,
              h: 4,
              fill: {
                gradient: {
                  type: 'radial',
                  focus: 'topLeft',
                  stops: [
                    { color: 'FFFFFF', pos: 0 },
                    { color: '000000', pos: 100 },
                  ],
                },
              },
            },
          },
        ]),
      ])
    );
  });

  it('matches for a pattern fill', async () => {
    await expectSamePackage(
      deck([
        slide([
          {
            name: 'shape',
            props: {
              type: 'rect',
              x: 1,
              y: 1,
              w: 4,
              h: 2,
              fill: {
                pattern: {
                  preset: 'pct25',
                  foreground: 'primary',
                  background: 'FFFFFF',
                },
              },
            },
          },
        ]),
      ])
    );
  });

  it('matches for a gradient slide background', async () => {
    await expectSamePackage(
      deck([
        slide([{ name: 'text', props: { text: 'Over gradient' } }], {
          background: {
            gradient: {
              type: 'linear',
              angle: 180,
              stops: [
                { color: 'primary', pos: 0 },
                { color: 'secondary', pos: 100 },
              ],
            },
          },
        }),
      ])
    );
  });

  it('matches for multiple gradients on one slide', async () => {
    const gradient = (angle: number) => ({
      type: 'linear',
      angle,
      stops: [
        { color: 'primary', pos: 0 },
        { color: 'accent', pos: 100 },
      ],
    });
    await expectSamePackage(
      deck([
        slide([
          {
            name: 'shape',
            props: {
              type: 'rect',
              x: 0.5,
              y: 0.5,
              w: 3,
              h: 2,
              fill: { gradient: gradient(0) },
            },
          },
          {
            name: 'shape',
            props: {
              type: 'rect',
              x: 4,
              y: 0.5,
              w: 3,
              h: 2,
              fill: { gradient: gradient(90) },
            },
          },
        ]),
      ])
    );
  });
});
