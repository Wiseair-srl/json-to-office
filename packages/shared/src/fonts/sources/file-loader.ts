/**
 * Load a .ttf/.otf file from disk.
 * Node-only — called from the render pipeline.
 */

import { readFile } from 'fs/promises';
import { isAbsolute, resolve as resolvePath } from 'path';
import type { ResolvedFontSource } from '../types';
import { detectFontFormat } from './format';

export interface FileSourceInput {
  path: string;
  weight?: number;
  italic?: boolean;
  baseDir?: string;
}

/** Read a font file and wrap as a ResolvedFontSource. */
export async function loadFileFontSource(
  input: FileSourceInput
): Promise<ResolvedFontSource> {
  const fullPath = isAbsolute(input.path)
    ? input.path
    : resolvePath(input.baseDir ?? process.cwd(), input.path);
  const data = await readFile(fullPath);
  return {
    data,
    weight: input.weight ?? 400,
    italic: input.italic ?? false,
    format: detectFontFormat(data),
  };
}
