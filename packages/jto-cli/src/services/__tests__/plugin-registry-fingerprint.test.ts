/**
 * PluginRegistry load fingerprinting (#156): reloading an unchanged plugin
 * set must be a no-op — no re-import, no cache invalidation — because the
 * playground fires /load-plugins repeatedly around page load and each call
 * used to clear every cache (resetting stats) once per plugin.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { PluginRegistry } from '../plugin-registry.js';
import { cacheEvents } from '../cache-events.js';

const PLUGIN_SOURCE = `
export default {
  name: 'fp-greeting',
  versions: {
    '1.0.0': {
      propsSchema: { type: 'object', properties: {} },
      render: async () => [
        { name: 'paragraph', props: { text: 'hello docx' } },
      ],
    },
  },
};
`;

describe('PluginRegistry load fingerprint', () => {
  let dir: string;
  let invalidations: number;
  const onInvalidate = () => {
    invalidations++;
  };

  beforeEach(async () => {
    // Discovery rejects scope paths outside the project root, so the
    // fixture directory must live inside the package (removed afterEach).
    dir = await fs.mkdtemp(path.join(process.cwd(), '.tmp-registry-fp-'));
    await fs.writeFile(
      path.join(dir, 'greeting.component.ts'),
      PLUGIN_SOURCE,
      'utf8'
    );
    PluginRegistry.getInstance().clear();
    invalidations = 0;
    cacheEvents.on('cache:invalidate', onInvalidate);
  });

  afterEach(async () => {
    cacheEvents.off('cache:invalidate', onInvalidate);
    PluginRegistry.getInstance().clear();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('loads once, then skips identical reloads without invalidating', async () => {
    const registry = PluginRegistry.getInstance();
    registry.setFormat('docx');

    const first = await registry.loadPluginsFromDirectory(dir);
    expect(first).toBe(1);
    expect(registry.getPluginNames()).toEqual(['fp-greeting']);
    // Exactly ONE invalidation for the whole batch.
    expect(invalidations).toBe(1);

    const second = await registry.loadPluginsFromDirectory(dir);
    expect(second).toBe(1);
    // Unchanged set: skipped entirely — stats-clearing invalidation not fired.
    expect(invalidations).toBe(1);
  });

  it('reloads and invalidates when a plugin file changes', async () => {
    const registry = PluginRegistry.getInstance();
    registry.setFormat('docx');

    await registry.loadPluginsFromDirectory(dir);
    expect(invalidations).toBe(1);

    // Touch the file with different content + mtime.
    const filePath = path.join(dir, 'greeting.component.ts');
    await fs.writeFile(
      filePath,
      PLUGIN_SOURCE.replace('hello docx', 'hello again'),
      'utf8'
    );
    const future = new Date(Date.now() + 5000);
    await fs.utimes(filePath, future, future);

    await registry.loadPluginsFromDirectory(dir);
    expect(invalidations).toBe(2);
  });
});
