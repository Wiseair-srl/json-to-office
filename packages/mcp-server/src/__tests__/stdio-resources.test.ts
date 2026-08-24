/**
 * The `jto://` resources, read the way a client actually reads them.
 *
 * `resources.test.ts` covers what the handlers return; this covers whether a
 * stock client can get it. Those are different questions, and they had
 * different answers: the DOCX document schema is 3.3 MB of JSON, and while it
 * was served pretty-printed it crossed the 10 MB per-frame ceiling that both
 * ends of the stdio transport apply by default — so reading it tore the
 * connection down and every request after it failed with "Not connected".
 *
 * Hence the two things asserted here that an in-process transport cannot see:
 * that every resource survives the trip, and that the connection is still
 * usable afterwards.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { openSession, type StdioSession } from './fixtures/stdio-harness.js';

const CONNECT_TIMEOUT_MS = 120_000;
const READ_TIMEOUT_MS = 180_000;

/** The stdio frame limit both the SDK client and server default to. */
const STDIO_MAX_FRAME_BYTES = 10 * 1024 * 1024;

let session: StdioSession;

beforeAll(async () => {
  session = await openSession();
}, CONNECT_TIMEOUT_MS);

afterAll(async () => {
  await session?.close();
});

describe('discovery resources over stdio', () => {
  it(
    'lists the catalogue, the renderers, the themes, the templates and both schemas per format',
    async () => {
      const { resources } = await session.client.listResources();

      expect(resources.map((resource) => resource.uri).sort()).toEqual([
        'jto://catalog',
        'jto://renderers',
        'jto://schema/docx/document',
        'jto://schema/docx/theme',
        'jto://schema/pptx/document',
        'jto://schema/pptx/theme',
        'jto://templates',
        'jto://themes',
      ]);

      for (const resource of resources) {
        expect(resource.mimeType).toBe('application/json');
        expect(resource.name).toBeTypeOf('string');
      }
    },
    CONNECT_TIMEOUT_MS
  );

  it(
    'reads every one of them on one connection, largest included',
    async () => {
      const { resources } = await session.client.listResources();
      const sizes: Record<string, number> = {};

      for (const resource of resources) {
        const read = await session.client.readResource({ uri: resource.uri });
        const [entry] = read.contents as [
          { uri: string; mimeType: string; text: string },
        ];

        expect(entry.uri).toBe(resource.uri);
        expect(entry.mimeType).toBe('application/json');

        const body = JSON.parse(entry.text) as Record<string, unknown>;
        expect(Object.keys(body).length).toBeGreaterThan(0);
        sizes[resource.uri] = entry.text.length;

        // The ceiling that made this suite necessary. Serving a resource a stock
        // client cannot receive is the same as not serving it.
        expect(
          entry.text.length,
          `${resource.uri} is ${entry.text.length} bytes, over the ${STDIO_MAX_FRAME_BYTES}-byte stdio frame limit`
        ).toBeLessThan(STDIO_MAX_FRAME_BYTES);
      }

      // Reading them all in sequence is the assertion: before the fix, the first
      // oversized body closed the transport and everything after it failed.
      expect(Object.keys(sizes)).toHaveLength(resources.length);

      // Still usable afterwards.
      const info = await session.client.callTool({
        name: 'jto_info',
        arguments: {},
      });
      expect((info.structuredContent as any).ok).toBe(true);
    },
    READ_TIMEOUT_MS
  );

  it(
    'serves schemas that resolve on their own and a catalogue that agrees with jto_discover',
    async () => {
      for (const format of ['docx', 'pptx']) {
        const read = await session.client.readResource({
          uri: `jto://schema/${format}/document`,
        });
        const schema = JSON.parse((read.contents[0] as any).text);
        expect(schema.$schema).toBeTypeOf('string');
        expect(schema.anyOf ?? schema.oneOf ?? schema.properties).toBeDefined();
      }

      const catalogRead = await session.client.readResource({
        uri: 'jto://catalog',
      });
      const catalog = JSON.parse((catalogRead.contents[0] as any).text);
      const discovered = await session.client.callTool({
        name: 'jto_discover',
        arguments: {},
      });

      // #204 wants the resource view and the tool view to agree; the drift test
      // proves it in-process, this proves the same two bodies survive the wire.
      expect(catalog.formats.map((format: any) => format.name)).toEqual(
        (discovered.structuredContent as any).formats.map(
          (format: any) => format.name
        )
      );
      for (const format of catalog.formats) {
        const fromTool = (discovered.structuredContent as any).formats.find(
          (entry: any) => entry.name === format.name
        );
        expect(
          format.components.map((component: any) => component.name)
        ).toEqual(fromTool.components.map((component: any) => component.name));
        expect(format.rootComponent).toBe(fromTool.rootComponent);
        expect(format.defaultRenderer).toBe(fromTool.defaultRenderer);
      }
    },
    READ_TIMEOUT_MS
  );
});
