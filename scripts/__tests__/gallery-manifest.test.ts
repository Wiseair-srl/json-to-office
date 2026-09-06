import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readPreviousGallery } from '../gallery-manifest';

const directories: string[] = [];
afterEach(() => {
  for (const dir of directories.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
function manifest(contents?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'jto-gallery-manifest-'));
  directories.push(dir);
  const filename = join(dir, 'gallery.json');
  if (contents !== undefined) writeFileSync(filename, contents);
  return filename;
}
describe('gallery regeneration manifest recovery', () => {
  it.each([
    undefined,
    '{ broken',
    '{}',
    '{"templates":null}',
    '{"templates":{}}',
  ])(
    'treats missing or unusable partial manifests as absent: %s',
    (contents) => {
      expect(readPreviousGallery(manifest(contents), true)).toEqual([]);
    }
  );
  it('reuses entries only for a partial regeneration', () => {
    const path = manifest('{"templates":[{"name":"existing"}]}');
    expect(readPreviousGallery(path, true)).toEqual([{ name: 'existing' }]);
    expect(readPreviousGallery(path, false)).toEqual([]);
  });
});
