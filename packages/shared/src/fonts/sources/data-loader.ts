/**
 * Decode a base64 / data-URL font payload to a Buffer.
 */

import type { ResolvedFontSource } from '../types';
import { detectFontFormat } from './format';

export interface DataSourceInput {
  data: string;
  weight?: number;
  italic?: boolean;
}

/**
 * Accepts either a bare base64 string or a data: URL.
 * Throws on invalid input; renderer catches and emits a warning.
 */
export function loadDataFontSource(input: DataSourceInput): ResolvedFontSource {
  const raw = input.data.trim();
  let b64: string;
  if (raw.startsWith('data:')) {
    const comma = raw.indexOf(',');
    if (comma < 0) throw new Error('Invalid data URL: no payload separator');
    // Only base64-encoded payloads are supported.
    const header = raw.slice(5, comma);
    if (!header.includes(';base64')) {
      throw new Error('Data URL must be base64-encoded');
    }
    b64 = raw.slice(comma + 1);
  } else {
    b64 = raw;
  }
  const data = Buffer.from(b64, 'base64');
  if (data.length === 0) throw new Error('Decoded font buffer is empty');
  return {
    data,
    weight: input.weight ?? 400,
    italic: input.italic ?? false,
    format: detectFontFormat(data),
  };
}
