/**
 * Whether a renderer can actually render, reported before it is chosen.
 *
 * `jto_info` and `jto_discover` listed `office-open` under both formats and
 * `jto_validate` validated cleanly against it, on hosts where its backend was
 * not installed at all — so the discovery surface, the validation surface and
 * the thing that actually renders disagreed, and only the last one told the
 * truth. Every renderer these tools advertise now carries whether it loads.
 *
 * A stub adapter rather than an uninstalled package: the backends are ordinary
 * dependencies now, so on a healthy tree there is nothing unavailable left to
 * observe, and the case worth pinning is the one a broken install produces.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { InMemoryTransport } from '@modelcontextprotocol/server';
import { Client } from '@modelcontextprotocol/client';

import { createServer } from '../server.js';
import { createToolDeps } from '../lib/deps.js';
import {
  getAdapter,
  type FormatAdapter,
  type FormatName,
} from '../lib/adapters.js';

/** The real adapters, with `office-open` reported as impossible to load. */
function brokenInstall(format: FormatName): FormatAdapter {
  const real = getAdapter(format);
  return {
    ...real,
    name: real.name,
    extension: real.extension,
    label: real.label,
    generateBuffer: real.generateBuffer.bind(real),
    createGenerator: real.createGenerator.bind(real),
    parseJson: real.parseJson.bind(real),
    validateDocument: real.validateDocument.bind(real),
    analyzeQuality: real.analyzeQuality.bind(real),
    generateSchema: real.generateSchema.bind(real),
    getBuiltinThemes: real.getBuiltinThemes.bind(real),
    resolveTheme: real.resolveTheme.bind(real),
    loadCustomThemes: real.loadCustomThemes.bind(real),
    rendererIds: real.rendererIds.bind(real),
    async rendererStatuses() {
      return (await real.rendererStatuses()).map((status) =>
        status.id === 'office-open'
          ? {
              ...status,
              available: false,
              reason: "Cannot find package '@office-open/docx'",
              installHint: 'pnpm add @office-open/docx',
            }
          : status
      );
    },
  };
}

let healthy: Client;
let broken: Client;

async function connect(getAdapterFor?: (f: FormatName) => FormatAdapter) {
  const server = createServer(
    createToolDeps({
      serverVersion: '9.9.9-test',
      ...(getAdapterFor ? { getAdapter: getAdapterFor } : {}),
    })
  );
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'availability-test', version: '1.0.0' });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return client;
}

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown> = {}
): Promise<any> {
  const result = await client.callTool({ name, arguments: args });
  return result.structuredContent as any;
}

beforeAll(async () => {
  [healthy, broken] = await Promise.all([connect(), connect(brokenInstall)]);
});

afterAll(async () => {
  await Promise.all([healthy.close(), broken.close()]);
});

describe('jto_info reports what each renderer can do here', () => {
  it('carries availability beside every id', async () => {
    const result = await call(healthy, 'jto_info', {
      includePreviewDependencies: false,
    });

    for (const format of result.formats) {
      expect(format.renderers.map((r: any) => r.id)).toEqual(
        format.rendererIds
      );
      for (const renderer of format.renderers) {
        expect(typeof renderer.available).toBe('boolean');
      }
      expect(format.renderers.filter((r: any) => r.default)).toHaveLength(1);
    }
  });

  it('finds every renderer usable on a healthy tree', async () => {
    // The backends are dependencies now, not optional peers: an install that
    // produced this tree produced them too.
    const result = await call(healthy, 'jto_info', {
      includePreviewDependencies: false,
    });

    for (const format of result.formats) {
      for (const renderer of format.renderers) {
        expect({ id: renderer.id, available: renderer.available }).toEqual({
          id: renderer.id,
          available: true,
        });
      }
    }
  });

  it('warns, with the install line, when one cannot load', async () => {
    const result = await call(broken, 'jto_info', {
      includePreviewDependencies: false,
    });

    const named = result.diagnostics.filter(
      (entry: any) => entry.context?.renderer === 'office-open'
    );
    expect(named.length).toBeGreaterThan(0);
    expect(named[0]).toMatchObject({
      severity: 'warning',
      code: 'E_DEPENDENCY_MISSING',
    });
    expect(named[0].suggestion).toContain('pnpm add @office-open/docx');
    // And it names one that does work, so the agent has somewhere to go.
    expect(named[0].suggestion).toContain('"docxjs"');
  });
});

describe('jto_discover marks a renderer it cannot run', () => {
  it('reports availability on each profile', async () => {
    const result = await call(broken, 'jto_discover', {
      format: 'docx',
      includeStarters: false,
    });
    const profiles = result.formats[0].renderers;

    expect(profiles.find((r: any) => r.id === 'office-open')).toMatchObject({
      available: false,
      installHint: 'pnpm add @office-open/docx',
    });
    expect(profiles.find((r: any) => r.id === 'docxjs')).toMatchObject({
      available: true,
    });
  });
});

describe('a probe that fails outright', () => {
  /** An adapter whose status probe throws, as a broken core would. */
  function unprobeable(format: FormatName): FormatAdapter {
    const real = getAdapter(format);
    return {
      ...real,
      name: real.name,
      extension: real.extension,
      label: real.label,
      generateSchema: real.generateSchema.bind(real),
      getBuiltinThemes: real.getBuiltinThemes.bind(real),
      resolveTheme: real.resolveTheme.bind(real),
      validateDocument: real.validateDocument.bind(real),
      rendererIds: real.rendererIds.bind(real),
      async rendererStatuses(): Promise<never> {
        throw new Error('core failed to load');
      },
    } as FormatAdapter;
  }

  it('reports no profile as usable', async () => {
    const client = await connect(unprobeable);
    try {
      const result = await call(client, 'jto_discover', {
        format: 'docx',
        includeStarters: false,
      });

      // The profiles still come from the generated schema, but nothing here
      // knows whether any of them can run — saying "available" would
      // contradict the diagnostic pushed beside them.
      const profiles = result.formats[0].renderers;
      expect(profiles.length).toBeGreaterThan(0);
      expect(profiles.map((r: any) => r.available)).not.toContain(true);
      expect(
        result.diagnostics.some((d: any) => d.code === 'E_DEPENDENCY_MISSING')
      ).toBe(true);
    } finally {
      await client.close();
    }
  });
});

describe('jto_validate no longer green-lights a renderer that cannot run', () => {
  const document = {
    name: 'docx',
    props: {},
    children: [
      {
        name: 'section',
        children: [{ name: 'paragraph', props: { text: 'Fine.' } }],
      },
    ],
  };

  it('warns when the requested profile has no backend', async () => {
    const result = await call(broken, 'jto_validate', {
      format: 'docx',
      document,
      renderer: 'office-open',
    });

    // A warning, not an error: the document is well-formed, the host is not
    // complete, and `valid` is still about the document.
    expect(result.valid).toBe(true);
    const named = result.diagnostics.filter(
      (entry: any) => entry.code === 'E_DEPENDENCY_MISSING'
    );
    expect(named).toHaveLength(1);
    expect(named[0].severity).toBe('warning');
    expect(named[0].suggestion).toContain('pnpm add @office-open/docx');
  });

  it('reads the renderer off the document when none is passed', async () => {
    const result = await call(broken, 'jto_validate', {
      format: 'docx',
      document: { ...document, renderer: 'office-open' },
    });

    expect(
      result.diagnostics.some(
        (entry: any) => entry.code === 'E_DEPENDENCY_MISSING'
      )
    ).toBe(true);
  });

  it('says nothing when the profile it will use is fine', async () => {
    const result = await call(broken, 'jto_validate', {
      format: 'docx',
      document,
    });

    expect(
      result.diagnostics.some(
        (entry: any) => entry.code === 'E_DEPENDENCY_MISSING'
      )
    ).toBe(false);
  });
});
