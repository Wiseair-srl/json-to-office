/**
 * Highcharts parity between the legacy pipeline and the IR pipeline.
 *
 * The export server is stubbed: what matters is that both paths send the same
 * request and place the returned PNG identically, not that a real server is
 * reachable.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { createHash } from 'node:crypto';
import { generateBufferFromJson } from '../../../core/generator';
import { generateBufferViaIr } from '../../../core/generateFromIr';
import type { PresentationComponentDefinition } from '../../../types';

const FAKE_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

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
): Promise<{ legacyRequest: unknown; irRequest: unknown }> {
  mockFetch.mockClear();
  const legacy = (await generateBufferFromJson(
    structuredClone(document) as never
  )) as Buffer;
  const legacyRequest = JSON.parse(mockFetch.mock.calls[0][1].body as string);

  mockFetch.mockClear();
  const { buffer: ir } = await generateBufferViaIr(
    structuredClone(document) as never
  );
  const irRequest = JSON.parse(mockFetch.mock.calls[0][1].body as string);

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

  return { legacyRequest, irRequest };
}

const deck = (
  props: Record<string, unknown>
): PresentationComponentDefinition =>
  ({
    name: 'pptx',
    props: { title: 'Highcharts' },
    children: [
      {
        name: 'slide',
        props: {},
        children: [{ name: 'highcharts', props }],
      },
    ],
  }) as PresentationComponentDefinition;

describe('highcharts parity', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(FAKE_PNG_B64),
    });
  });

  it('matches for a chart sized from the export server response', async () => {
    const { legacyRequest, irRequest } = await expectSamePackage(
      deck({
        options: {
          chart: { width: 960, height: 480 },
          series: [{ data: [1, 2, 3] }],
        },
      })
    );
    expect(irRequest).toEqual(legacyRequest);
  });

  it('matches for explicit position and size', async () => {
    await expectSamePackage(
      deck({
        options: { chart: { width: 960, height: 720 } },
        x: 1,
        y: 0.5,
        w: 5,
        h: 3,
      })
    );
  });

  it('sends the same request payload, including the injected theme palette', async () => {
    const { legacyRequest, irRequest } = await expectSamePackage(
      deck({ options: { chart: { width: 640, height: 480 } } })
    );

    expect(irRequest).toEqual(legacyRequest);
    expect(
      (irRequest as { infile: { colors: string[] } }).infile.colors
    ).toBeDefined();
  });

  it('leaves an explicit colors array alone', async () => {
    const { legacyRequest, irRequest } = await expectSamePackage(
      deck({
        options: {
          chart: { width: 640, height: 480 },
          colors: ['#111111', '#222222'],
        },
      })
    );

    expect(irRequest).toEqual(legacyRequest);
    expect(
      (irRequest as { infile: { colors: string[] } }).infile.colors
    ).toEqual(['#111111', '#222222']);
  });

  it('forwards resources and scale identically', async () => {
    const { legacyRequest, irRequest } = await expectSamePackage(
      deck({
        options: { chart: { width: 640, height: 480 } },
        scale: 2,
        resources: { css: '.hc { color: red }' },
      })
    );

    expect(irRequest).toEqual(legacyRequest);
    expect(irRequest).toMatchObject({
      scale: 2,
      resources: { css: '.hc { color: red }' },
    });
  });
});
