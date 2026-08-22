/**
 * A digest of what an OOXML package *contains*, independent of how it is
 * compressed.
 *
 * The corpus goldens used to be a SHA-256 of the raw `.docx` bytes. That is a
 * strictly stronger claim than "the document is unchanged" — it also asserts
 * that the deflate stream is identical, and deflate is the runtime's, not this
 * pipeline's. A Node release that changes its bundled zlib changes every byte
 * of every package while changing nothing about any document, and the whole
 * corpus fails at once with nothing to distinguish it from a real regression
 * (#264).
 *
 * So the golden covers the parts: their order, their names, and their exact
 * uncompressed bytes. Anything a reader can observe is in there; the encoding
 * of the container is not. Byte-for-byte stability *within* one runtime is a
 * separate claim, and the corpus suites still assert it by rendering twice.
 */

import AdmZip from 'adm-zip';
import { createHash } from 'node:crypto';

export function packageDigest(buffer: Buffer): string {
  const hash = createHash('sha256');

  // Central-directory order as the reader reports it, rather than a sort of
  // our own: the order a package's parts appear in is the writer's and stays
  // fixed, so it costs nothing to cover and would show a writer that changed
  // it. (adm-zip happens to emit parts name-sorted, so for a package this
  // pipeline finalises the two coincide.)
  for (const entry of new AdmZip(buffer).getEntries()) {
    if (entry.isDirectory) continue;
    const data = entry.getData();
    hash.update(entry.entryName, 'utf8');
    hash.update('\0');
    hash.update(String(data.length));
    hash.update('\0');
    hash.update(data);
  }

  return hash.digest('hex');
}
