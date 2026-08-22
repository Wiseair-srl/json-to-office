/**
 * Load every image a document references, before anything is compiled.
 *
 * A DOCX embeds images by value, so the bytes have to be in hand to build one —
 * and fetching them is asynchronous, while compiling to IR is not. Keeping the
 * compiler synchronous is worth a pre-pass: it makes compilation a pure
 * function of the document plus this map, which is what lets the IR be compared,
 * cached and snapshotted.
 *
 * Sources are deduplicated, so the same image used ten times is fetched once
 * and embedded once.
 */

import type { ComponentDefinition } from '../types';
import {
  getImageBuffer,
  getImageDimensions,
  resolveImageSource,
} from '../utils/imageUtils';

export interface LoadedImage {
  bytes: Buffer;
  /** From the HTTP response, when the source was fetched over the network. */
  contentType?: string;
  /** Pixel size as stored, when it could be read. */
  intrinsic?: { width: number; height: number };
}

/**
 * Images by source string.
 *
 * A source that could not be loaded is absent rather than recorded as an
 * error: the compiler reports it against the component's own path, which is
 * more use than an error attached to a URL.
 */
export type ImageResources = ReadonlyMap<string, LoadedImage>;

/** Load every image source in `components`, following nested content. */
export async function loadImageResources(
  components: Iterable<ComponentDefinition | undefined>
): Promise<ImageResources> {
  const sources = new Set<string>();
  for (const component of components) collectSources(component, sources);

  const loaded = new Map<string, LoadedImage>();
  await Promise.all(
    [...sources].map(async (source) => {
      try {
        const result = await getImageBuffer(source);
        const intrinsic = await readIntrinsic(source);
        loaded.set(source, {
          bytes: result.buffer,
          ...(result.contentType ? { contentType: result.contentType } : {}),
          ...(intrinsic ? { intrinsic } : {}),
        });
      } catch {
        // Left out of the map; the compiler reports it against the component.
      }
    })
  );
  return loaded;
}

async function readIntrinsic(
  source: string
): Promise<{ width: number; height: number } | undefined> {
  try {
    return await getImageDimensions(source);
  } catch {
    // An unreadable header is not a failure to load: the image still embeds,
    // it just cannot contribute an aspect ratio.
    return undefined;
  }
}

/**
 * Every image source under one component.
 *
 * Images hide in more places than the component tree suggests — inside table
 * cells, inside header and footer content — so this walks the shapes that can
 * hold one rather than only a component's `children`.
 */
function collectSources(
  component: ComponentDefinition | undefined,
  out: Set<string>
): void {
  if (!component || typeof component !== 'object') return;

  if (component.name === 'image') {
    const source = resolveImageSource(
      (component.props ?? {}) as {
        svg?: string;
        base64?: string;
        path?: string;
      }
    );
    if (source) out.add(source);
  }

  const children = (component as { children?: ComponentDefinition[] }).children;
  for (const child of children ?? []) collectSources(child, out);

  const props = (component.props ?? {}) as Record<string, unknown>;
  for (const key of ['header', 'footer'] as const) {
    const part = props[key];
    if (Array.isArray(part)) {
      for (const child of part)
        collectSources(child as ComponentDefinition, out);
    }
  }

  const columns = props.columns;
  if (Array.isArray(columns)) {
    for (const column of columns as Record<string, unknown>[]) {
      const header = column?.header as { content?: unknown } | undefined;
      collectCellSource(header?.content, out);
      const cells = column?.cells;
      if (Array.isArray(cells)) {
        for (const cell of cells as { content?: unknown }[]) {
          collectCellSource(cell?.content, out);
        }
      }
    }
  }
}

function collectCellSource(content: unknown, out: Set<string>): void {
  if (content && typeof content === 'object') {
    collectSources(content as ComponentDefinition, out);
  }
}
