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
 * Hard upper bound on the decoded font buffer. Real TTF/OTF faces are well
 * under 5 MB; even variable-axis fonts with CJK coverage rarely exceed 4 MB.
 * Rejecting oversized payloads before decoding prevents a malicious
 * `kind: 'data'` registry entry from allocating arbitrary server memory
 * when the generator runs behind an HTTP endpoint.
 */
const MAX_DATA_FONT_BYTES = 5 * 1024 * 1024;

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
  // Upper-bound the decoded size via base64 length before allocating. A
  // base64 string decodes to ~3/4 its character count, so a conservative
  // check on the encoded size avoids decoding a 50 MB payload just to
  // reject it afterward.
  const approxDecodedBytes = Math.floor((b64.length * 3) / 4);
  if (approxDecodedBytes > MAX_DATA_FONT_BYTES) {
    throw new Error(
      `Font data payload exceeds ${MAX_DATA_FONT_BYTES} byte limit`
    );
  }
  const data = Buffer.from(b64, 'base64');
  if (data.length === 0) throw new Error('Decoded font buffer is empty');
  if (data.length > MAX_DATA_FONT_BYTES) {
    throw new Error(
      `Font data payload exceeds ${MAX_DATA_FONT_BYTES} byte limit`
    );
  }
  // Base64 decoding silently discards invalid characters, so garbage input
  // yields a non-empty buffer that isn't a real font. Magic-byte check
  // rejects the garbage before it reaches the LibreOffice preview stager.
  const format = detectFontFormat(data);
  if (format === 'unknown') {
    throw new Error(
      'Decoded font buffer is not a recognized font (expected TTF/OTF/WOFF/WOFF2)'
    );
  }
  // WOFF/WOFF2 flow through: Office output never embeds bytes, and the
  // LibreOffice preview stager handles them via fontconfig.
  return {
    data,
    weight: input.weight ?? 400,
    italic: input.italic ?? false,
    format,
  };
}
