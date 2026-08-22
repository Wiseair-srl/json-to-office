/**
 * Legacy pipeline vs. IR pipeline, same backend.
 *
 * Both paths end at PptxGenJS, so for anything the compiler lowers they must
 * produce the same package. Byte equality is the bar where it holds; where it
 * cannot, the difference has to be visible and explained, not averaged away.
 *
 * Scope is the Phase 2 vertical slice: metadata, slide size, slides, solid
 * backgrounds, text (single and rich-run), images and preset shapes.
 */

import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { createHash } from 'node:crypto';
import { generateBufferFromJson } from '../../../core/generator';
import { generateBufferViaIr } from '../../../core/generateFromIr';
import type { PresentationComponentDefinition } from '../../../types';

/** A 1x1 transparent PNG. */
const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

async function entries(buffer: Buffer): Promise<Map<string, string>> {
  const zip = await JSZip.loadAsync(buffer);
  const out = new Map<string, string>();
  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    const bytes = await entry.async('nodebuffer');
    out.set(
      path,
      path.endsWith('.xml') || path.endsWith('.rels')
        ? await entry.async('string')
        : `sha256:${createHash('sha256').update(bytes).digest('hex')}`
    );
  }
  return out;
}

async function bothPaths(
  document: PresentationComponentDefinition
): Promise<{ legacy: Buffer; ir: Buffer }> {
  const legacy = await generateBufferFromJson(
    structuredClone(document) as never
  );
  const { buffer: ir } = await generateBufferViaIr(
    structuredClone(document) as never
  );
  return { legacy: legacy as Buffer, ir };
}

/** Compare every package part, reporting the first differing one usefully. */
async function expectSamePackage(
  document: PresentationComponentDefinition
): Promise<void> {
  const { legacy, ir } = await bothPaths(document);
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

const slide = (
  children: unknown[],
  props: Record<string, unknown> = {}
): unknown => ({ name: 'slide', props, children });

const deck = (
  children: unknown[],
  props: Record<string, unknown> = {}
): PresentationComponentDefinition =>
  ({
    name: 'pptx',
    props: { title: 'Parity', author: 'JTO', ...props },
    children,
  }) as PresentationComponentDefinition;

describe('IR pipeline parity with the legacy pipeline', () => {
  it('matches for a plain text slide', async () => {
    await expectSamePackage(
      deck([slide([{ name: 'text', props: { text: 'Hello' } }])])
    );
  });

  it('matches for positioned, styled text', async () => {
    await expectSamePackage(
      deck([
        slide([
          {
            name: 'text',
            props: {
              text: 'Positioned',
              x: 1,
              y: 0.75,
              w: 4,
              h: 1.25,
              fontSize: 22,
              bold: true,
              italic: true,
              color: 'primary',
              align: 'center',
              valign: 'middle',
              charSpacing: 2,
              lineSpacing: 30,
              paraSpaceBefore: 4,
              paraSpaceAfter: 6,
              margin: 3,
            },
          },
        ]),
      ])
    );
  });

  it('matches for percentage-positioned text', async () => {
    await expectSamePackage(
      deck([
        slide([
          {
            name: 'text',
            props: { text: 'Percent', x: '10%', y: '20%', w: '50%', h: '25%' },
          },
        ]),
      ])
    );
  });

  it('matches for rich text runs', async () => {
    await expectSamePackage(
      deck([
        slide([
          {
            name: 'text',
            props: {
              x: 0.5,
              y: 0.5,
              w: 6,
              h: 2,
              fontSize: 16,
              runs: [
                { text: 'plain ' },
                { text: 'bold', bold: true },
                { text: ' and ', italic: true },
                {
                  text: 'coloured',
                  color: 'accent',
                  fontSize: 20,
                  underline: true,
                  breakLine: true,
                },
                { text: 'sub', subscript: true, charSpacing: 1 },
                { text: 'sup', superscript: true, strike: true },
              ],
            },
          },
        ]),
      ])
    );
  });

  it('matches for named theme styles', async () => {
    await expectSamePackage(
      deck([
        slide([
          { name: 'text', props: { text: 'Title', style: 'title', y: 0.4 } },
          { name: 'text', props: { text: 'Body', style: 'body', y: 2 } },
        ]),
      ])
    );
  });

  it('matches for page-number placeholders', async () => {
    await expectSamePackage(
      deck(
        [
          slide([
            { name: 'text', props: { text: '{PAGE_NUMBER}/{PAGE_COUNT}' } },
          ]),
          slide([
            { name: 'text', props: { text: '{PAGE_NUMBER}/{PAGE_COUNT}' } },
          ]),
        ],
        { pageNumberFormat: '09' }
      )
    );
  });

  it('matches for preset shapes with fills and lines', async () => {
    await expectSamePackage(
      deck([
        slide([
          {
            name: 'shape',
            props: {
              type: 'roundRect',
              x: 0.5,
              y: 0.5,
              w: 3,
              h: 1.5,
              fill: { color: 'secondary', transparency: 20 },
              line: { color: '333333', width: 2, dashType: 'dash' },
              rectRadius: 0.2,
            },
          },
          {
            name: 'shape',
            props: {
              type: 'ellipse',
              x: 4,
              y: 0.5,
              w: 2,
              h: 2,
              fill: { color: 'accent' },
              rotate: 30,
              flipH: true,
            },
          },
        ]),
      ])
    );
  });

  it('matches for a shape carrying text', async () => {
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
              h: 1,
              fill: { color: 'FFFFFF' },
              text: 'Inside the shape',
              fontSize: 18,
              fontColor: 'text',
              align: 'center',
              valign: 'middle',
            },
          },
        ]),
      ])
    );
  });

  it('matches for a shape with text segments', async () => {
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
              h: 1.5,
              fill: { color: 'EEEEEE' },
              text: [
                { text: 'one ', bold: true },
                { text: 'two', color: 'primary', breakLine: true },
                { text: 'three', fontSize: 24 },
              ],
            },
          },
        ]),
      ])
    );
  });

  it('matches for a base64 image', async () => {
    await expectSamePackage(
      deck([
        slide([
          {
            name: 'image',
            props: { base64: PNG_1PX, x: 1, y: 1, w: 2, h: 2, alt: 'dot' },
          },
        ]),
      ])
    );
  });

  it('matches for a solid slide background', async () => {
    await expectSamePackage(
      deck([
        slide([{ name: 'text', props: { text: 'On colour' } }], {
          background: { color: 'primary' },
        }),
      ])
    );
  });

  it('matches for hidden slides and speaker notes', async () => {
    await expectSamePackage(
      deck([
        slide([{ name: 'text', props: { text: 'One' } }], {
          notes: 'Speaker note',
        }),
        slide([{ name: 'text', props: { text: 'Two' } }], { hidden: true }),
      ])
    );
  });

  it('matches for external and slide hyperlinks', async () => {
    await expectSamePackage(
      deck([
        slide([
          {
            name: 'text',
            props: {
              text: 'External',
              hyperlink: { url: 'https://example.com', tooltip: 'go' },
            },
          },
          {
            name: 'text',
            props: { text: 'Internal', y: 1, hyperlink: { slide: 2 } },
          },
        ]),
        slide([{ name: 'text', props: { text: 'Target' } }]),
      ])
    );
  });

  it('matches for grid-positioned components', async () => {
    await expectSamePackage(
      deck(
        [
          slide([
            {
              name: 'text',
              props: {
                text: 'Grid',
                grid: { column: 2, row: 1, columnSpan: 4, rowSpan: 2 },
              },
            },
          ]),
        ],
        { grid: { columns: 12, rows: 6, margin: 0.4, gutter: 0.15 } }
      )
    );
  });

  it('matches for a deck-wide language and rtl mode', async () => {
    await expectSamePackage(
      deck([slide([{ name: 'text', props: { text: 'Ciao' } }])], {
        language: 'it-IT',
        rtlMode: true,
      })
    );
  });

  it('matches for a custom slide size', async () => {
    await expectSamePackage(
      deck([slide([{ name: 'text', props: { text: 'Wide' } }])], {
        slideWidth: 13.333,
        slideHeight: 7.5,
      })
    );
  });

  it('matches for a shadow', async () => {
    await expectSamePackage(
      deck([
        slide([
          {
            name: 'shape',
            props: {
              type: 'rect',
              x: 1,
              y: 1,
              w: 2,
              h: 2,
              fill: { color: '112233' },
              shadow: { type: 'outer', color: '000000', blur: 5, offset: 2 },
            },
          },
        ]),
      ])
    );
  });

  it('matches for a disabled slide and a disabled component', async () => {
    await expectSamePackage(
      deck([
        slide([
          { name: 'text', props: { text: 'kept' } },
          { name: 'text', props: { text: 'dropped' }, enabled: false } as never,
        ]),
        { ...(slide([]) as object), enabled: false } as never,
        slide([{ name: 'text', props: { text: 'last' } }]),
      ])
    );
  });
});

describe('IR pipeline determinism', () => {
  it('produces identical bytes across runs', async () => {
    const document = deck([
      slide([
        { name: 'text', props: { text: 'Stable' } },
        {
          name: 'shape',
          props: {
            type: 'rect',
            x: 1,
            y: 1,
            w: 1,
            h: 1,
            fill: { color: 'primary' },
          },
        },
      ]),
    ]);

    const first = await generateBufferViaIr(structuredClone(document) as never);
    const second = await generateBufferViaIr(
      structuredClone(document) as never
    );

    expect(first.buffer.equals(second.buffer)).toBe(true);
  });
});
