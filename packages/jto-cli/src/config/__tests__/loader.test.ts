import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../loader.js';

function configFile(config: Record<string, unknown>): string {
  const directory = mkdtempSync(join(tmpdir(), 'jto-loader-'));
  const filepath = join(directory, 'json-to-office.config.json');
  writeFileSync(filepath, JSON.stringify(config));
  return filepath;
}

describe('loadConfig port resolution', () => {
  const originalPort = process.env.PORT;

  afterEach(() => {
    if (originalPort === undefined) delete process.env.PORT;
    else process.env.PORT = originalPort;
  });

  it('falls back to PORT when the config file sets no port', async () => {
    process.env.PORT = '4321';

    const config = await loadConfig(configFile({ mode: 'development' }));

    expect(config.server.port).toBe(4321);
  });

  it('keeps a config-file port over PORT', async () => {
    process.env.PORT = '4321';

    const config = await loadConfig(
      configFile({ server: { port: 5555, host: 'localhost' } })
    );

    expect(config.server.port).toBe(5555);
  });

  it('ignores an unusable PORT', async () => {
    process.env.PORT = 'not-a-port';

    const config = await loadConfig(configFile({ mode: 'development' }));

    expect(config.server.port).toBe(3003);
  });

  it("honours a PORT that equals the packaged default over the caller's", async () => {
    process.env.PORT = '3003';

    const config = await loadConfig(configFile({ mode: 'development' }), {
      defaultPort: 3004,
    });

    expect(config.server.port).toBe(3003);
  });

  // The sibling above asserts 3003, which is also the packaged default, so it
  // only pins the ordering. This one uses a port no default can produce, so it
  // fails if the PORT fallback stops being applied at all.
  it("prefers PORT over the caller's default", async () => {
    process.env.PORT = '4321';

    const config = await loadConfig(configFile({ mode: 'development' }), {
      defaultPort: 3004,
    });

    expect(config.server.port).toBe(4321);
  });

  it("falls back to the caller's default when PORT is unset", async () => {
    delete process.env.PORT;

    const config = await loadConfig(configFile({ mode: 'development' }), {
      defaultPort: 3004,
    });

    expect(config.server.port).toBe(3004);
  });

  it('does not leak a mutated config into later loads', async () => {
    delete process.env.PORT;

    const first = await loadConfig(configFile({ mode: 'development' }));
    first.server.port = 9999;
    first.server.host = '0.0.0.0';

    const second = await loadConfig(configFile({ mode: 'development' }));

    expect(second.server).toEqual({ port: 3003, host: 'localhost' });
  });

  it('does not leak a mutated fallback config into later loads', async () => {
    delete process.env.PORT;

    // `server.port` as a string fails schema validation → defaults path.
    const broken = configFile({ server: { port: 'nope', host: 'localhost' } });
    const first = await loadConfig(broken);
    first.server.port = 9999;
    first.server.host = '0.0.0.0';

    const second = await loadConfig(broken);

    expect(second.server).toEqual({ port: 3003, host: 'localhost' });
  });
});
