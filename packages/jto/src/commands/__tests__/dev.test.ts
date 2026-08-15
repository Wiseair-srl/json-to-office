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

vi.mock('@json-to-office/jto-cli', () => ({
  EXIT_CODES: { OK: 0, FAIL: 1 },
  formatError: mocks.formatError,
  loadConfig: mocks.loadConfig,
  renderLines: mocks.renderLines,
  runTask: mocks.runTask,
}));

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
