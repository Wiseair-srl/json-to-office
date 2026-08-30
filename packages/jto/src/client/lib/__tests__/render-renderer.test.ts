/**
 * The preview request has to name the backend the picker selected.
 *
 * `renderDocument` sends the JSON and lets the server regenerate, so the chosen
 * backend has to travel with it. Without that the preview came from the default
 * renderer and the download from the selected one — the picker's two halves
 * showing different documents (#255).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderDocument } from '../render';

interface Sent {
  options?: { sourceName?: string; renderer?: string };
}

function captureRequest(): { body: () => Sent | undefined } {
  let sent: Sent | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: { body: string }) => {
      sent = JSON.parse(init.body) as Sent;
      return {
        ok: true,
        status: 200,
        blob: async () => new Blob([new Uint8Array([1, 2, 3])]),
      };
    })
  );
  vi.stubGlobal('URL', {
    createObjectURL: () => 'blob:preview',
    revokeObjectURL: () => undefined,
  });
  return { body: () => sent };
}

const blob = new Blob([new Uint8Array([1])]);
const json = JSON.stringify({ name: 'docx', props: {}, children: [] });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('renderDocument', () => {
  it('sends the selected renderer with the document', async () => {
    const request = captureRequest();

    const result = await renderDocument('doc', blob, json, {}, 'office-open');

    expect(result.status).toBe('success');
    expect(request.body()?.options?.renderer).toBe('office-open');
    // The source name still rides along, which is what resolves relative
    // asset paths (#142).
    expect(request.body()?.options?.sourceName).toBe('doc');
  });

  it('says nothing about the renderer when none is selected', async () => {
    const request = captureRequest();

    await renderDocument('doc', blob, json, {});

    // Absent, not `undefined`: the server reads "use the format's default"
    // from the field being missing.
    expect(request.body()?.options).not.toHaveProperty('renderer');
  });

  it('prefers an explicit sourceName over the display name', async () => {
    const request = captureRequest();

    // A renamed copy of a bundled template: the display name means nothing to
    // the server, the provenance is what resolves its media and fonts.
    await renderDocument(
      'my-report',
      blob,
      json,
      {},
      undefined,
      'vermilion-annual-report'
    );

    expect(request.body()?.options?.sourceName).toBe('vermilion-annual-report');
  });
});
