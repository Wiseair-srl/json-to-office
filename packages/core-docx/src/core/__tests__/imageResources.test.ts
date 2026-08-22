/**
 * How many times a source is loaded, and which bytes the size comes from.
 *
 * The pre-pass used to fetch each image once for its bytes and again for its
 * dimensions. Twice the traffic is the visible half; the other half is that a
 * source whose response changes between the two — a signed URL, a `/random`
 * endpoint, a file being written — embedded one image and sized it from
 * another, so the aspect ratio belonged to a picture that is not in the
 * document (#267).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadImageResources } from '../imageResources';
import type { ComponentDefinition } from '../../types';

/** A 4×2 PNG and a 2×4 one, so a swapped response is visible in the size. */
const WIDE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAABytg0kAAAAFElEQVR42mNk+M9QzwAFjDAGACPuA/8fMSCgAAAAAElFTkSuQmCC',
  'base64'
);
const TALL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAAECAYAAACtBE5DAAAAFElEQVR42mNkYPhfz0AEYBxVSF+FAP5FBQXeGH0OAAAAAElFTkSuQmCC',
  'base64'
);

function respondWith(...bodies: Buffer[]): { calls: () => number } {
  let call = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const body = bodies[Math.min(call, bodies.length - 1)];
      call += 1;
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: () => 'image/png' },
        arrayBuffer: async () =>
          body.buffer.slice(
            body.byteOffset,
            body.byteOffset + body.byteLength
          ) as ArrayBuffer,
      };
    })
  );
  return { calls: () => call };
}

const image = (path: string): ComponentDefinition =>
  ({ name: 'image', props: { path } }) as unknown as ComponentDefinition;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadImageResources', () => {
  it('fetches a remote source once', async () => {
    const fetches = respondWith(WIDE);

    const loaded = await loadImageResources([image('https://host/one.png')]);

    expect(fetches.calls()).toBe(1);
    expect(loaded.get('https://host/one.png')?.intrinsic).toEqual({
      width: 4,
      height: 2,
    });
  });

  it('still fetches once when the same source is placed twice', async () => {
    const fetches = respondWith(WIDE);

    await loadImageResources([
      image('https://host/one.png'),
      image('https://host/one.png'),
    ]);

    expect(fetches.calls()).toBe(1);
  });

  it('sizes the image from the bytes it embedded, not a second response', async () => {
    // The endpoint answers differently every time. Two loads would embed the
    // 4×2 and record 2×4 as its intrinsic size.
    respondWith(WIDE, TALL);

    const loaded = await loadImageResources([image('https://host/rand.png')]);
    const entry = loaded.get('https://host/rand.png');

    expect(entry?.bytes.equals(WIDE)).toBe(true);
    expect(entry?.intrinsic).toEqual({ width: 4, height: 2 });
  });

  it('keeps a base64 source loadable and measurable', async () => {
    const source = `data:image/png;base64,${WIDE.toString('base64')}`;

    const loaded = await loadImageResources([image(source)]);

    expect(loaded.get(source)?.intrinsic).toEqual({ width: 4, height: 2 });
  });

  it('embeds an unmeasurable image without an intrinsic size', async () => {
    respondWith(Buffer.from('not an image'));

    const loaded = await loadImageResources([image('https://host/bad.png')]);
    const entry = loaded.get('https://host/bad.png');

    expect(entry).toBeDefined();
    expect(entry?.intrinsic).toBeUndefined();
  });
});
