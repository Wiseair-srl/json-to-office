/**
 * The bundled gallery, over the protocol and off the disk.
 *
 * The property that matters is the one the ticket exists for: an agent with no
 * network can find every designed template, read what each is for, look at it,
 * and then open a document that its own schema accepts. Each of those is a
 * separate way for the bundle to be quietly wrong — a manifest that describes a
 * document nobody ships, a resource that lists a name no read resolves, a
 * template that stopped validating the release the schema tightened.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { InMemoryTransport } from '@modelcontextprotocol/server';
import { Client } from '@modelcontextprotocol/client';

import { createServer } from '../server.js';
import { createToolDeps } from '../lib/deps.js';
import { getAdapter } from '../lib/adapters.js';
import { RESOURCE_URIS } from '../resources/index.js';
import {
  galleryDocument,
  galleryManifest,
  galleryManifests,
  galleryThumbnail,
} from '../templates/gallery.js';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let client: Client;

beforeAll(async () => {
  const server = createServer(createToolDeps({ serverVersion: '9.9.9-test' }));
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'gallery-test', version: '1.0.0' });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
});

afterAll(async () => {
  await client.close();
});

async function readResource(uri: string) {
  const result = await client.readResource({ uri });
  return result.contents as Array<{
    text?: string;
    blob?: string;
    mimeType?: string;
  }>;
}

describe('the bundle on disk', () => {
  const manifests = galleryManifests();

  it('ships nine designed templates across both formats', () => {
    expect(manifests.length).toBe(9);
    expect(new Set(manifests.map((entry) => entry.format))).toEqual(
      new Set(['docx', 'pptx'])
    );
  });

  it('says what each one is for, which no script could derive', () => {
    for (const manifest of manifests) {
      expect(manifest.archetype, manifest.name).toBeTruthy();
      expect(manifest.whenToUse.length, manifest.name).toBeGreaterThan(60);
      expect(manifest.pages, manifest.name).toBeGreaterThan(0);
    }
  });

  it('carries a slot inventory, so the filling job has a size', () => {
    for (const manifest of manifests) {
      const slots = Object.values(manifest.slots).reduce(
        (sum, count) => sum + count,
        0
      );
      expect(slots, manifest.name).toBeGreaterThan(0);
      expect(
        Object.keys(manifest.components).length,
        manifest.name
      ).toBeGreaterThan(0);
    }
  });

  it('decompresses to a document its own schema accepts', () => {
    // The gallery is only worth bundling if copying one is a working start.
    for (const manifest of manifests) {
      const document = galleryDocument(manifest.name);
      expect(document, manifest.name).toBeDefined();
      const result = getAdapter(manifest.format).validateDocument(document);
      expect(result.errors ?? [], manifest.name).toEqual([]);
    }
  });

  it('ships a readable PNG thumbnail for every template', () => {
    for (const manifest of manifests) {
      const png = galleryThumbnail(manifest.name);
      expect(png, manifest.name).toBeDefined();
      expect(png!.subarray(0, 8), manifest.name).toEqual(PNG_MAGIC);
      // Under the inline image budget, so an agent can actually look at it.
      expect(png!.length, manifest.name).toBeLessThan(2 * 1024 * 1024);
    }
  });

  it('declares the images and fonts it does not ship', () => {
    // Half the templates expect photography that is deliberately absent: an
    // agent copying one supplies its own, and shipping stock imagery would
    // invite it to send someone else's.
    const withAssets = manifests.filter(
      (manifest) => manifest.externalAssets.length > 0
    );
    expect(withAssets.length).toBeGreaterThan(0);
    for (const manifest of manifests) {
      for (const asset of manifest.externalAssets) {
        expect(asset, manifest.name).not.toMatch(/\.(otf|ttf|ttc|woff2?)$/i);
      }
      for (const font of manifest.externalFonts) {
        expect(font, manifest.name).toMatch(/\.(otf|ttf|ttc|woff2?)$/i);
      }
    }
  });

  it('answers nothing for a name it does not have', () => {
    expect(galleryManifest('nope.docx.json')).toBeUndefined();
    expect(galleryDocument('nope.docx.json')).toBeUndefined();
    expect(galleryThumbnail('nope.docx.json')).toBeUndefined();
  });
});

describe('over the protocol', () => {
  it('lists every template as its own resource, document and thumbnail', async () => {
    const { resources } = await client.listResources();
    const uris = new Set(resources.map((resource) => resource.uri));
    for (const manifest of galleryManifests()) {
      expect(uris, manifest.name).toContain(
        RESOURCE_URIS.template(manifest.name)
      );
      expect(uris, manifest.name).toContain(
        RESOURCE_URIS.templateThumbnail(manifest.name)
      );
    }
  });

  it('serves the manifest alongside the starters', async () => {
    const [content] = await readResource(RESOURCE_URIS.templates);
    const body = JSON.parse(content.text ?? '{}');
    expect(body.starters.length).toBeGreaterThan(0);
    expect(body.gallery.map((entry: { name: string }) => entry.name)).toEqual(
      galleryManifests().map((manifest) => manifest.name)
    );
  });

  it('reads a template document back', async () => {
    const name = 'tech-report.docx.json';
    const [content] = await readResource(RESOURCE_URIS.template(name));
    expect(content.mimeType).toBe('application/json');
    const document = JSON.parse(content.text ?? 'null');
    expect(document.name).toBe('docx');
    expect(Array.isArray(document.children)).toBe(true);
  });

  it('reads a thumbnail as a PNG blob', async () => {
    const [content] = await readResource(
      RESOURCE_URIS.templateThumbnail('minimalist-pitch-deck.pptx.json')
    );
    expect(content.mimeType).toBe('image/png');
    const png = Buffer.from(content.blob ?? '', 'base64');
    expect(png.subarray(0, 8)).toEqual(PNG_MAGIC);
  });

  it('shows the gallery in jto_discover, with no network', async () => {
    const result = await client.callTool({
      name: 'jto_discover',
      arguments: { format: 'pptx' },
    });
    const payload = result.structuredContent as {
      formats: Array<{
        name: string;
        gallery: Array<{ name: string; archetype: string; pages: number }>;
      }>;
    };
    const pptx = payload.formats.find((format) => format.name === 'pptx');
    expect(pptx?.gallery.length).toBe(galleryManifests('pptx').length);
    expect(pptx?.gallery.every((entry) => entry.pages > 0)).toBe(true);
    // The catalogue is per format; a deck must not carry the reports.
    expect(
      pptx?.gallery.every((entry) => entry.name.endsWith('.pptx.json'))
    ).toBe(true);
  });
});
