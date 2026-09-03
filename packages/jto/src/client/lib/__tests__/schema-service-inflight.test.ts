import { beforeEach, describe, expect, it, vi } from 'vitest';
import { schemaService } from '../schema-service';

/**
 * The document schema is megabytes of JSON and several parts of the page ask
 * for the same one within the same tick on load. The result cache cannot help
 * there — it is empty until the first answer lands — so identical requests
 * that are still in flight share one response.
 */
describe('schemaService in-flight coalescing', () => {
  beforeEach(() => {
    schemaService.clearCache();
    vi.restoreAllMocks();
  });

  it('sends one request when the same schema is asked for concurrently', async () => {
    let resolveFetch: (value: unknown) => void = () => {};
    const fetchMock = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
    );
    vi.stubGlobal('fetch', fetchMock);

    const first = schemaService.fetchDocumentSchema(['weather']);
    const second = schemaService.fetchDocumentSchema(['weather']);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch({
      ok: true,
      json: async () => ({ success: true, data: { type: 'object' } }),
    });
    expect(await first).toEqual({ type: 'object' });
    expect(await second).toEqual({ type: 'object' });
  });

  it('keeps requests for different component sets apart', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ success: true, data: { type: 'object' } }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await Promise.all([
      schemaService.fetchDocumentSchema(
        [],
        [{ name: 'callout', versions: [{ version: '1.0.0', propsSchema: {} }] }]
      ),
      schemaService.fetchDocumentSchema(
        [],
        [
          {
            name: 'callout',
            versions: [{ version: '1.0.0', propsSchema: {} }],
          },
          { name: 'prova', versions: [{ version: '1.0.0', propsSchema: {} }] },
        ]
      ),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not share a request that was sent before an invalidation', async () => {
    // The clearing caller is asking for an answer newer than the one already
    // on the wire, so it must not be handed that one.
    const resolvers: Array<(value: unknown) => void> = [];
    const fetchMock = vi.fn(
      () => new Promise((resolve) => resolvers.push(resolve))
    );
    vi.stubGlobal('fetch', fetchMock);

    const stale = schemaService.fetchDocumentSchema(['weather']);
    schemaService.clearPluginSchemaCache();
    const fresh = schemaService.fetchDocumentSchema(['weather']);

    expect(fetchMock).toHaveBeenCalledTimes(2);

    resolvers[1]({
      ok: true,
      json: async () => ({ success: true, data: { rebuilt: true } }),
    });
    resolvers[0]({
      ok: true,
      json: async () => ({ success: true, data: { rebuilt: false } }),
    });

    // Each caller still gets the answer to the question it asked...
    expect(await fresh).toEqual({ rebuilt: true });
    expect(await stale).toEqual({ rebuilt: false });

    // ...but the one sent before the invalidation did not reach the cache, so
    // the next caller is not served the schema that was declared stale.
    const next = await schemaService.fetchDocumentSchema(['weather']);
    expect(next).toEqual({ rebuilt: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shares an in-flight request with a caller that only bypasses the cache', async () => {
    // A cache bypass is not an invalidation: the request on the wire is still
    // the answer being asked for, and it is megabytes.
    let resolveFetch: (value: unknown) => void = () => {};
    const fetchMock = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
    );
    vi.stubGlobal('fetch', fetchMock);

    const first = schemaService.fetchDocumentSchema(['weather'], undefined, {
      bypassCache: true,
    });
    const second = schemaService.fetchDocumentSchema(['weather'], undefined, {
      bypassCache: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch({
      ok: true,
      json: async () => ({ success: true, data: { type: 'object' } }),
    });
    expect(await first).toEqual({ type: 'object' });
    expect(await second).toEqual({ type: 'object' });
  });

  it('never serves a stored schema to a bypassing caller', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ success: true, data: { type: 'object' } }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await schemaService.fetchDocumentSchema(['weather']);
    await schemaService.fetchDocumentSchema(['weather']);
    expect(fetchMock).toHaveBeenCalledTimes(1); // second call was a cache hit

    await schemaService.fetchDocumentSchema(['weather'], undefined, {
      bypassCache: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('lets a later request through once the first has answered', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ success: true, data: { type: 'object' } }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await schemaService.fetchDocumentSchema(['weather']);
    schemaService.clearPluginSchemaCache();
    await schemaService.fetchDocumentSchema(['weather']);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
