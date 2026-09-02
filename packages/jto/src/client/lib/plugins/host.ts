import { useBrowserPluginsStore } from '../../store/browser-plugins-store';
import type { PluginRenderRequest, PluginRenderResult } from './expand';
import { SandboxFrame } from './sandbox-frame';
import type {
  BrowserPluginMetadata,
  PluginExample,
  PluginFormat,
  SandboxRequest,
  SandboxResponse,
} from './types';

/**
 * The page side of the sandbox: one frame (and one worker) per plugin file,
 * request/response over `postMessage`, hard time limits.
 *
 * A plugin that misses its deadline is torn down, not asked nicely — an
 * infinite loop in a render cannot be interrupted any other way — and the
 * next request starts a fresh one from the persisted compiled code. Idle
 * plugins are torn down too: a worker nobody is rendering with has no
 * business running.
 */

export interface LoadSpec {
  js: string;
  format: PluginFormat;
  allowNetwork: boolean;
  examples: PluginExample[];
}

const LOAD_TIMEOUT_MS = 8_000;
const RENDER_TIMEOUT_MS = 20_000;
const IDLE_TIMEOUT_MS = 30_000;

/** `Omit` that distributes over the request union instead of intersecting it. */
type RequestPayload<T> = T extends { id: number } ? Omit<T, 'id'> : never;
type SandboxRequestPayload = RequestPayload<SandboxRequest>;

interface Pending {
  resolve: (response: SandboxResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface Entry {
  frame: SandboxFrame;
  /** The spec the worker was loaded with; null until `loaded` arrives. */
  loaded: LoadSpec | null;
  pending: Map<number, Pending>;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

export class PluginTimeoutError extends Error {
  constructor(docName: string, what: string, ms: number) {
    super(
      `Plugin "${docName}" did not finish ${what} within ${Math.round(ms / 1000)}s and was stopped.`
    );
    this.name = 'PluginTimeoutError';
  }
}

export class PluginAbortedError extends Error {
  constructor(docName: string) {
    super(`Plugin "${docName}" render was cancelled`);
    this.name = 'PluginAbortedError';
  }
}

let runtimePromise: Promise<string> | null = null;

/** The bundled runtime, fetched once; a failed load is retried next time. */
function loadRuntime(): Promise<string> {
  if (!runtimePromise) {
    runtimePromise = import('virtual:jto-sandbox-runtime')
      .then((module) => module.default)
      .catch((error) => {
        runtimePromise = null;
        throw error;
      });
  }
  return runtimePromise;
}

function sameSpec(a: LoadSpec, b: LoadSpec): boolean {
  return (
    a.js === b.js &&
    a.format === b.format &&
    a.allowNetwork === b.allowNetwork &&
    JSON.stringify(a.examples) === JSON.stringify(b.examples)
  );
}

class PluginHost {
  private entries = new Map<string, Entry>();
  private nextId = 1;

  private async entry(docName: string, allowNetwork: boolean): Promise<Entry> {
    const existing = this.entries.get(docName);
    if (existing) return existing;
    const runtime = await loadRuntime();
    // Two callers racing to create the same frame: the second wins nothing.
    const raced = this.entries.get(docName);
    if (raced) return raced;
    const entry: Entry = {
      frame: null as unknown as SandboxFrame,
      loaded: null,
      pending: new Map(),
      idleTimer: null,
    };
    entry.frame = new SandboxFrame({
      runtime,
      allowNetwork,
      onMessage: (data) => {
        const response = data as SandboxResponse;
        if (!response || typeof response.id !== 'number') return;
        const pending = entry.pending.get(response.id);
        if (!pending) return;
        entry.pending.delete(response.id);
        clearTimeout(pending.timer);
        pending.resolve(response);
        this.touch(docName, entry);
      },
      onError: (message) => {
        this.dispose(
          docName,
          new Error(`Plugin "${docName}" crashed: ${message}`)
        );
      },
    });
    this.entries.set(docName, entry);
    return entry;
  }

  /** Restart the idle clock; a frame with nothing pending is closed after it. */
  private touch(docName: string, entry: Entry): void {
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    entry.idleTimer = setTimeout(() => {
      if (entry.pending.size === 0 && this.entries.get(docName) === entry) {
        this.dispose(docName);
      }
    }, IDLE_TIMEOUT_MS);
  }

  private async request(
    docName: string,
    allowNetwork: boolean,
    payload: SandboxRequestPayload,
    timeoutMs: number,
    what: string,
    signal?: AbortSignal
  ): Promise<SandboxResponse> {
    if (signal?.aborted) throw new PluginAbortedError(docName);
    const entry = await this.entry(docName, allowNetwork);
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    const id = this.nextId++;
    const result = new Promise<SandboxResponse>((resolve, reject) => {
      // The caller's signal outlives this request — a build aborts its signal
      // during cleanup, long after the renders it guarded have settled. Left
      // attached, that abort would dispose the frame and reject whatever is
      // in flight at the time, so the listener goes when the request does.
      let onAbort: (() => void) | null = null;
      const detach = () => {
        if (onAbort) signal?.removeEventListener('abort', onAbort);
        onAbort = null;
      };
      const timer = setTimeout(() => {
        entry.pending.delete(id);
        detach();
        this.dispose(docName, new PluginTimeoutError(docName, what, timeoutMs));
        reject(new PluginTimeoutError(docName, what, timeoutMs));
      }, timeoutMs);
      entry.pending.set(id, {
        resolve: (response) => {
          detach();
          resolve(response);
        },
        reject: (error) => {
          detach();
          reject(error);
        },
        timer,
      });
      onAbort = () => {
        // A cancelled build must not leave a render burning in the worker.
        this.dispose(docName, new PluginAbortedError(docName));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      entry.frame.post({ id, ...payload } as SandboxRequest).catch((error) => {
        entry.pending.delete(id);
        clearTimeout(timer);
        detach();
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
    return result;
  }

  /** Evaluate compiled code in a fresh sandbox and describe the component. */
  async load(docName: string, spec: LoadSpec): Promise<BrowserPluginMetadata> {
    const existing = this.entries.get(docName);
    if (existing && (!existing.loaded || !sameSpec(existing.loaded, spec))) {
      // The policy and the module state are per frame: a new spec gets a
      // new one.
      this.dispose(docName, new Error(`Plugin "${docName}" was reloaded`));
    }
    const response = await this.request(
      docName,
      spec.allowNetwork,
      { type: 'load', ...spec },
      LOAD_TIMEOUT_MS,
      'loading'
    );
    if (response.type === 'error') {
      this.dispose(docName, new Error(response.message));
      throw new Error(response.message);
    }
    if (response.type !== 'loaded') {
      throw new Error(`Unexpected sandbox reply "${response.type}"`);
    }
    const entry = this.entries.get(docName);
    if (entry) entry.loaded = spec;
    return response.metadata;
  }

  /**
   * Render one component instance. Loads the sandbox from the persisted
   * record first when nothing is running (a reload, a timeout, idleness).
   */
  async render(
    docName: string,
    request: PluginRenderRequest,
    signal?: AbortSignal
  ): Promise<PluginRenderResult> {
    const record = useBrowserPluginsStore.getState().records[docName];
    const entry = this.entries.get(docName);
    if (!entry || !entry.loaded) {
      if (!record?.js || !record.metadata) {
        throw new Error(`Plugin "${docName}" is not compiled`);
      }
      await this.load(docName, {
        js: record.js,
        format: record.metadata.format,
        allowNetwork: record.allowNetwork,
        examples: record.metadata.examples,
      });
    }
    const response = await this.request(
      docName,
      record?.allowNetwork ?? false,
      {
        type: 'render',
        version: request.version,
        props: request.props,
        theme: request.theme,
        children: request.children,
      },
      RENDER_TIMEOUT_MS,
      'rendering',
      signal
    );
    if (response.type === 'error') throw new Error(response.message);
    if (response.type !== 'rendered') {
      throw new Error(`Unexpected sandbox reply "${response.type}"`);
    }
    return { components: response.components, warnings: response.warnings };
  }

  /** Tear the sandbox down; every request still in flight rejects with `reason`. */
  dispose(docName: string, reason?: Error): void {
    const entry = this.entries.get(docName);
    if (!entry) return;
    this.entries.delete(docName);
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    for (const pending of entry.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(reason ?? new Error(`Plugin "${docName}" was unloaded`));
    }
    entry.pending.clear();
    entry.frame.dispose();
  }

  isLoaded(docName: string): boolean {
    return this.entries.get(docName)?.loaded != null;
  }
}

export const pluginHost = new PluginHost();
