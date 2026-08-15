import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FormatAdapter } from '@json-to-office/jto-cli';
import { createDevCommand } from '../dev.js';

const mocks = vi.hoisted(() => ({
  formatError: vi.fn(),
  loadConfig: vi.fn(),
  renderLines: vi.fn(),
  runTask: vi.fn(),
  serverConstructor: vi.fn(),
  serverStart: vi.fn(),
  serverStop: vi.fn(),
}));

// `loadConfig` is mocked so the lifecycle tests stay hermetic, but the real
// one is kept alongside it: the port-resolution tests below delegate to it so
// the config file > PORT > adapter default chain is actually exercised.
vi.mock('@json-to-office/jto-cli', async () => {
  const actual = await vi.importActual<
    typeof import('@json-to-office/jto-cli')
  >('@json-to-office/jto-cli');
  return {
    EXIT_CODES: { OK: 0, FAIL: 1 },
    formatError: mocks.formatError,
    loadConfig: mocks.loadConfig,
    renderLines: mocks.renderLines,
    runTask: mocks.runTask,
    __actualLoadConfig: actual.loadConfig,
  };
});

vi.mock('../../server/unified-server.js', () => ({
  UnifiedServer: class {
    constructor(...args: unknown[]) {
      mocks.serverConstructor(...args);
    }

    start() {
      return mocks.serverStart();
    }

    stop() {
      return mocks.serverStop();
    }
  },
}));

const adapter = {
  name: 'docx',
  defaultPort: 3003,
} as FormatAdapter;

function newSignalListeners(
  signal: NodeJS.Signals,
  previous: Function[]
): Function[] {
  return process
    .listeners(signal)
    .filter((listener) => !previous.includes(listener));
}

describe('dev command Ink lifecycle', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.loadConfig.mockResolvedValue({
      server: { host: 'localhost', port: 3003 },
    });
    mocks.runTask.mockImplementation(
      async (_initial: string, task: () => Promise<unknown>) => task()
    );
    mocks.renderLines.mockResolvedValue(undefined);
    mocks.formatError.mockResolvedValue(undefined);
    mocks.serverStart.mockResolvedValue(undefined);
    mocks.serverStop.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders startup details and stops through Ink before exiting', async () => {
    const existingSigint = process.listeners('SIGINT');
    const existingSigterm = process.listeners('SIGTERM');
    const exit = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);

    await createDevCommand(adapter).parseAsync(
      ['--port', '4100', '--host', '0.0.0.0'],
      { from: 'user' }
    );

    expect(mocks.runTask).toHaveBeenNthCalledWith(
      1,
      'Starting DOCX dev server...',
      expect.any(Function),
      { success: 'Server ready', failure: 'Failed to start dev server' }
    );
    expect(mocks.serverConstructor).toHaveBeenCalledWith(
      adapter,
      expect.objectContaining({
        server: { host: '0.0.0.0', port: 4100 },
      })
    );
    expect(mocks.renderLines).toHaveBeenCalledWith(
      expect.arrayContaining([
        { text: 'Local:   http://0.0.0.0:4100' },
        { text: 'Health:  http://0.0.0.0:4100/health' },
      ])
    );

    const [shutdown] = newSignalListeners('SIGINT', existingSigint);
    expect(shutdown).toBeTypeOf('function');
    shutdown();

    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    expect(mocks.runTask).toHaveBeenNthCalledWith(
      2,
      'Shutting down...',
      expect.any(Function),
      { success: 'Server stopped', failure: 'Failed to stop server' }
    );
    expect(mocks.serverStop).toHaveBeenCalledOnce();
    expect(mocks.serverStop.mock.invocationCallOrder[0]).toBeLessThan(
      exit.mock.invocationCallOrder[0]
    );
    expect(newSignalListeners('SIGINT', existingSigint)).toHaveLength(0);
    expect(newSignalListeners('SIGTERM', existingSigterm)).toHaveLength(0);
  });

  it('renders startup errors before exiting', async () => {
    const error = new Error('port unavailable');
    mocks.serverStart.mockRejectedValue(error);
    const exit = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);

    await createDevCommand(adapter).parseAsync([], { from: 'user' });

    expect(mocks.formatError).toHaveBeenCalledWith(error);
    expect(exit).toHaveBeenCalledWith(1);
    expect(mocks.formatError.mock.invocationCallOrder[0]).toBeLessThan(
      exit.mock.invocationCallOrder[0]
    );
  });

  it('renders shutdown errors before exiting', async () => {
    const existingSigterm = process.listeners('SIGTERM');
    const error = new Error('close failed');
    mocks.serverStop.mockRejectedValue(error);
    const exit = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);

    await createDevCommand(adapter).parseAsync([], { from: 'user' });
    const [shutdown] = newSignalListeners('SIGTERM', existingSigterm);
    shutdown();

    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    expect(mocks.formatError).toHaveBeenCalledWith(error);
    expect(mocks.formatError.mock.invocationCallOrder[0]).toBeLessThan(
      exit.mock.invocationCallOrder[0]
    );
  });
});

describe('dev command port resolution', () => {
  // A format whose default port is deliberately not the packaged 3003, so a
  // "port === 3003 means nobody asked" sentinel would be visible.
  const pptxAdapter = { name: 'pptx', defaultPort: 3005 } as FormatAdapter;
  let tempDir: string;
  let previousPort: string | undefined;

  async function startedPort(
    adapterUnderTest: FormatAdapter,
    argv: string[] = []
  ): Promise<number> {
    await createDevCommand(adapterUnderTest).parseAsync(argv, {
      from: 'user',
    });
    const [, config] = mocks.serverConstructor.mock.calls[0] as [
      FormatAdapter,
      { server: { port: number } },
    ];
    return config.server.port;
  }

  function writeConfig(port: number): string {
    const file = join(tempDir, 'json-to-office.config.json');
    writeFileSync(file, JSON.stringify({ server: { port } }));
    return file;
  }

  beforeEach(async () => {
    vi.resetAllMocks();
    tempDir = mkdtempSync(join(tmpdir(), 'jto-dev-port-'));
    previousPort = process.env.PORT;
    delete process.env.PORT;

    // Delegate to the real loader so the precedence chain is under test, not
    // a stubbed return value.
    const cli = (await import('@json-to-office/jto-cli')) as unknown as {
      __actualLoadConfig: typeof import('@json-to-office/jto-cli').loadConfig;
    };
    mocks.loadConfig.mockImplementation(cli.__actualLoadConfig);
    mocks.runTask.mockImplementation(
      async (_initial: string, task: () => Promise<unknown>) => task()
    );
    mocks.renderLines.mockResolvedValue(undefined);
    mocks.formatError.mockResolvedValue(undefined);
    mocks.serverStart.mockResolvedValue(undefined);
    mocks.serverStop.mockResolvedValue(undefined);
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  });

  afterEach(() => {
    if (previousPort === undefined) {
      delete process.env.PORT;
    } else {
      process.env.PORT = previousPort;
    }
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('honours PORT=3003 for a format whose default port is not 3003', async () => {
    process.env.PORT = '3003';

    expect(await startedPort(pptxAdapter)).toBe(3003);
  });

  it('falls back to the adapter default when nothing else names a port', async () => {
    expect(await startedPort(pptxAdapter)).toBe(3005);
  });

  it('prefers PORT over the adapter default', async () => {
    process.env.PORT = '4200';

    expect(await startedPort(pptxAdapter)).toBe(4200);
  });

  it('prefers the config file over PORT', async () => {
    process.env.PORT = '4200';

    expect(
      await startedPort(pptxAdapter, ['--config', writeConfig(4300)])
    ).toBe(4300);
  });

  it('prefers --port over the config file and PORT', async () => {
    process.env.PORT = '4200';

    expect(
      await startedPort(pptxAdapter, [
        '--config',
        writeConfig(4300),
        '--port',
        '4400',
      ])
    ).toBe(4400);
  });

  it('passes the adapter default through to the loader', async () => {
    await startedPort(pptxAdapter);

    expect(mocks.loadConfig).toHaveBeenCalledWith(undefined, {
      defaultPort: 3005,
    });
  });
});
