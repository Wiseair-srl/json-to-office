/**
 * The render manifest: every image embedded in the package, in the order of
 * the blips that embed it, with the node of the returned definitions that
 * produced it.
 *
 * Everything the tests compare against is read back out of the `.docx`
 * itself — the blips of each part, their relationships, the media bytes — so
 * the manifest is checked against the file, not against what the pipeline
 * believes it wrote.
 */

import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Type } from '@sinclair/typebox';
import JSZip from 'jszip';
import { resetChartLimiters } from '@json-to-office/shared';
import { createComponent, createVersion } from '../createComponent';
import { createDocumentGenerator } from '../createDocumentGenerator';
import { ensureThemeDefaults } from '../../themes/defaults';
import { generateBufferViaIr } from '../../core/generateFromIr';
import { buildRenderManifest } from '../../core/renderManifest';
import { CORPUS } from '../../__tests__/fixtures/corpus';
import type { ComponentDefinition } from '../../types';
import type { DocxRendererId } from '../../renderers/types';

/** Three distinct PNGs, so each image in a document can be told apart. */
const PNG_A =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAAEklEQVR42mOIrt34HxkzoAsAAE/xFEFoJgXRAAAAAElFTkSuQmCC';
const PNG_B =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const PNG_C =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
/** What the mocked export server answers for every chart. */
const CHART_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const sha256 = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');

const testTheme = ensureThemeDefaults({
  name: 'test',
  displayName: 'Test Theme',
  description: 'Simple theme for testing',
});

/** A map renderer: emits two id-less images and a caption between them. */
const mapcharts = createComponent({
  name: 'mapcharts',
  versions: {
    '1.0.0': createVersion({
      propsSchema: Type.Object(
        { region: Type.String() },
        { additionalProperties: false }
      ),
      render: async ({ props }): Promise<ComponentDefinition[]> => [
        { name: 'image', props: { base64: PNG_A } },
        { name: 'paragraph', props: { text: `Map of ${props.region}` } },
        { name: 'image', props: { base64: PNG_B } },
      ],
    }),
  },
});

/** A full-page picture, left expanded: its node is not preserved. */
const fullPageImage = createComponent({
  name: 'full-page-image',
  versions: {
    '1.0.0': createVersion({
      propsSchema: Type.Object({}, { additionalProperties: false }),
      render: async (): Promise<ComponentDefinition[]> => [
        { name: 'image', props: { base64: PNG_C } },
      ],
    }),
  },
});

const chart = {
  name: 'highcharts',
  props: {
    options: {
      chart: { type: 'column', width: 600, height: 300 },
      series: [{ type: 'column', data: [1, 2, 3] }],
    },
  },
};

/** A header image, a paragraph, the map, a chart and the full-page image. */
const reportDocument = {
  name: 'docx',
  props: {},
  children: [
    {
      name: 'section',
      props: { header: [{ name: 'image', props: { base64: PNG_C } }] },
      children: [
        { name: 'paragraph', props: { text: 'Mobility report' } },
        { name: 'mapcharts', props: { region: 'Lombardia' } },
        chart,
        { name: 'full-page-image', props: {} },
      ],
    },
  ],
};

interface PackageBlip {
  partPath: string;
  mediaPath: string;
  sha256: string;
}

/** The blips of one part, read independently of the manifest's own reader. */
async function packageBlips(
  buffer: Buffer,
  partPath: string
): Promise<PackageBlip[]> {
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file(partPath)!.async('string');
  const relsPath = posix.join(
    posix.dirname(partPath),
    '_rels',
    `${posix.basename(partPath)}.rels`
  );
  const rels = new Map<string, string>();
  for (const m of (await zip.file(relsPath)!.async('string')).matchAll(
    /<Relationship\b[^>]*>/g
  )) {
    const id = /\bId="([^"]+)"/.exec(m[0])![1];
    const target = /\bTarget="([^"]+)"/.exec(m[0])![1];
    rels.set(id, posix.join(posix.dirname(partPath), target));
  }
  const out: PackageBlip[] = [];
  for (const m of xml.matchAll(/<a:blip\b[^>]*\br:embed="([^"]+)"/g)) {
    const mediaPath = rels.get(m[1])!;
    const bytes = await zip.file(mediaPath)!.async('uint8array');
    out.push({ partPath, mediaPath, sha256: sha256(bytes) });
  }
  return out;
}

/** Read a dot path out of a definition tree. */
function at(root: unknown, path: string): Record<string, unknown> {
  return path
    .split('.')
    .reduce<unknown>(
      (node, key) => (node as Record<string, unknown>)[key],
      root
    ) as Record<string, unknown>;
}

const mockFetch = vi.fn();

beforeEach(() => {
  resetChartLimiters();
  mockFetch.mockReset();
  mockFetch.mockImplementation(async () => ({
    ok: true,
    text: async () => CHART_PNG_BASE64,
  }));
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const RENDERERS: DocxRendererId[] = ['docxjs', 'office-open'];

describe('renderManifest', { timeout: 60_000 }, () => {
  it.each(RENDERERS)(
    'attributes every image of a preserved component, a chart and a header on %s',
    async (renderer) => {
      const generator = createDocumentGenerator({ theme: testTheme, renderer })
        .addComponent(mapcharts)
        .addComponent(fullPageImage);

      const result = await generator.generateBuffer(reportDocument as never, {
        preserveCustomComponents: ['mapcharts'],
      });
      const manifest = result.renderManifest!;
      expect(manifest).toBeDefined();

      // Two map images, the chart and the full-page image in the body; the
      // header image in its own part.
      const body = await packageBlips(result.buffer, 'word/document.xml');
      const header = await packageBlips(result.buffer, 'word/header1.xml');
      expect(manifest).toHaveLength(5);
      expect(body).toHaveLength(4);
      expect(header).toHaveLength(1);

      // Body entries come first, in blip order, then the header; each names
      // the media its blip embeds and that media's hash.
      expect(
        manifest.map(({ partPath, mediaPath, sha256 }) => ({
          partPath,
          mediaPath,
          sha256,
        }))
      ).toEqual([...body, ...header]);
      expect(manifest.map((e) => e.part)).toEqual([
        'body',
        'body',
        'body',
        'body',
        'header',
      ]);

      const [mapA, mapB, chartImage, fullPage, headerImage] = manifest;

      // Both nodes the preserved map emitted point at the one map node.
      expect(mapA).toMatchObject({
        standardPath: 'children.0.children.1',
        kind: 'image',
        sourcePath: 'children.0.children.1',
        sourceKind: 'mapcharts',
      });
      expect(mapB).toMatchObject({
        standardPath: 'children.0.children.3',
        kind: 'image',
        sourcePath: 'children.0.children.1',
        sourceKind: 'mapcharts',
      });
      expect(at(result.preservedDefinition, mapA.sourcePath!)).toMatchObject({
        name: 'mapcharts',
        props: { region: 'Lombardia' },
      });
      for (const entry of [mapA, mapB]) {
        expect(at(result.standardDefinition, entry.standardPath).name).toBe(
          'image'
        );
      }
      expect(
        (at(result.standardDefinition, mapA.standardPath).props as never)[
          'base64'
        ]
      ).toBe(PNG_A);

      // The chart is a standard node: its own path, no source.
      expect(chartImage).toEqual({
        part: 'body',
        partPath: 'word/document.xml',
        mediaPath: body[2].mediaPath,
        sha256: sha256(Buffer.from(CHART_PNG_BASE64, 'base64')),
        standardPath: 'children.0.children.4',
        kind: 'highcharts',
      });
      expect(at(result.standardDefinition, chartImage.standardPath).name).toBe(
        'highcharts'
      );

      // A custom component that was not preserved has no place in the
      // preserved tree, so its image carries no source either.
      expect(fullPage.standardPath).toBe('children.0.children.5');
      expect(fullPage.kind).toBe('image');
      expect(fullPage).not.toHaveProperty('sourcePath');
      expect(fullPage).not.toHaveProperty('sourceKind');

      expect(headerImage).toMatchObject({
        part: 'header',
        partPath: 'word/header1.xml',
        standardPath: 'children.0.props.header.0',
        kind: 'image',
        sha256: sha256(Buffer.from(PNG_C.split(',')[1], 'base64')),
      });
      expect(result.warnings ?? []).toEqual([]);
    }
  );

  it.each(RENDERERS)(
    'gives one entry per occurrence when identical images share a media file on %s',
    async (renderer) => {
      const generator = createDocumentGenerator({ theme: testTheme, renderer });
      const result = await generator.generateBuffer({
        name: 'docx',
        props: {},
        children: [
          {
            name: 'section',
            props: {},
            children: [
              { name: 'image', props: { base64: PNG_A } },
              { name: 'paragraph', props: { text: 'Between' } },
              { name: 'image', props: { base64: PNG_A } },
            ],
          },
        ],
      } as never);

      const manifest = result.renderManifest!;
      expect(manifest).toHaveLength(2);
      expect(manifest[0].mediaPath).toBe(manifest[1].mediaPath);
      expect(manifest[0].sha256).toBe(manifest[1].sha256);
      expect(manifest.map((e) => e.standardPath)).toEqual([
        'children.0.children.0',
        'children.0.children.2',
      ]);

      const zip = await JSZip.loadAsync(result.buffer);
      const media = Object.values(zip.files)
        .filter((f) => !f.dir && f.name.startsWith('word/media/'))
        .map((f) => f.name);
      expect(media).toHaveLength(1);
      expect(manifest[0].mediaPath).toBe(media[0]);
    }
  );

  it('reports a preserved component reached through document blocks', async () => {
    const generator = createDocumentGenerator({ theme: testTheme })
      .addComponent(mapcharts)
      .addComponent(fullPageImage);
    const result = await generator.generateBuffer(
      {
        ...reportDocument,
        props: { blocks: {} },
        children: [
          {
            name: 'section',
            props: {},
            children: [
              { name: 'paragraph', props: { text: 'Mobility report' } },
              { name: 'mapcharts', props: { region: 'Veneto' } },
              { name: 'full-page-image', props: {} },
            ],
          },
        ],
      } as never,
      { preserveCustomComponents: ['mapcharts'] }
    );

    const manifest = result.renderManifest!;
    expect(manifest.map((e) => [e.standardPath, e.sourcePath])).toEqual([
      ['children.0.children.1.children.0', 'children.0.children.1'],
      ['children.0.children.1.children.2', 'children.0.children.1'],
      ['children.0.children.2.children.0', undefined],
    ]);
    expect(at(result.preservedDefinition, 'children.0.children.1').name).toBe(
      'mapcharts'
    );
    for (const entry of manifest) {
      expect(at(result.standardDefinition, entry.standardPath).name).toBe(
        entry.kind
      );
    }
  });

  it('builds a manifest when rendering from a prepared quality model', async () => {
    const generator = createDocumentGenerator({ theme: testTheme })
      .addComponent(mapcharts)
      .addComponent(fullPageImage);
    const { prepared } = await generator.prepareQuality(
      reportDocument as never
    );
    const result = await generator.generateBuffer(reportDocument as never, {
      prepared,
    });

    const manifest = result.renderManifest!;
    const body = await packageBlips(result.buffer, 'word/document.xml');
    expect(
      manifest
        .filter((e) => e.part === 'body')
        .map(({ partPath, mediaPath, sha256 }) => ({
          partPath,
          mediaPath,
          sha256,
        }))
    ).toEqual(body);
    for (const entry of manifest) {
      expect(at(result.standardDefinition, entry.standardPath).name).toBe(
        entry.kind
      );
      // No preserved tree on this path, so no source either.
      expect(entry).not.toHaveProperty('sourcePath');
    }
    expect(manifest.map((e) => e.kind)).toEqual([
      'image',
      'image',
      'highcharts',
      'image',
      'image',
    ]);
  });

  it('accounts for every image of every corpus document', async () => {
    const unaccounted: string[] = [];
    for (const testCase of CORPUS) {
      const rendered = await generateBufferViaIr(
        structuredClone(testCase.document) as never,
        { warnings: [] }
      );
      const built = buildRenderManifest(
        rendered.buffer,
        rendered.ir,
        rendered.imageOrigins
      );
      if (!built.ok) {
        unaccounted.push(`${testCase.name}: ${built.reason}`);
        continue;
      }
      const zip = await JSZip.loadAsync(rendered.buffer);
      const blips = (
        await zip.file('word/document.xml')!.async('string')
      ).match(/<a:blip\b/g)?.length;
      const body = built.manifest.filter((e) => e.part === 'body').length;
      if (body !== (blips ?? 0)) {
        unaccounted.push(`${testCase.name}: ${body} of ${blips} body blips`);
      }
    }
    expect(unaccounted).toEqual([]);
  }, 120_000);
});
