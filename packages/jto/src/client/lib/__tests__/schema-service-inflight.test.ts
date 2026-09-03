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
