/**
 * Concurrent `discoverAndLoad()` calls must coalesce into one discovery pass.
 * The playground's bootstrap POST /load-plugins and on-demand schema loads
 * race on page load; without coalescing each ran its own discovery walk and
 * re-imported every plugin.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PluginRegistry } from '../plugin-registry.js';

describe('PluginRegistry discoverAndLoad coalescing', () => {
  beforeEach(() => {
    PluginRegistry.getInstance().clear();
  });

  afterEach(() => {
    PluginRegistry.getInstance().clear();
    vi.restoreAllMocks();
  });

  it('runs one discovery pass for concurrent callers', async () => {
    const registry = PluginRegistry.getInstance();
    registry.setFormat('docx');

    const discover = vi
      .spyOn((registry as any).discoveryService, 'discover')
      .mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve([]), 20))
      );

    const [a, b, c] = await Promise.all([
      registry.discoverAndLoad(),
      registry.discoverAndLoad(),
      registry.discoverAndLoad(),
    ]);

    expect(discover).toHaveBeenCalledTimes(1);
    expect(a).toEqual({ discovered: 0, loaded: 0 });
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it('runs a fresh pass once the previous one settled', async () => {
    const registry = PluginRegistry.getInstance();
    registry.setFormat('docx');

    const discover = vi
      .spyOn((registry as any).discoveryService, 'discover')
      .mockResolvedValue([]);

    await registry.discoverAndLoad();
    await registry.discoverAndLoad();

    expect(discover).toHaveBeenCalledTimes(2);
  });
});
