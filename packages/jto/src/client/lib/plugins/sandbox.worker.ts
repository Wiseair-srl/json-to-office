/**
 * The plugin sandbox runtime: one worker per browser plugin.
 *
 * The page never runs plugin code itself. This script is bundled whole
 * (vite.config.ts, `jto-sandbox-runtime`) and started from a blob: URL inside
 * an opaque-origin iframe whose Content-Security-Policy it inherits
 * (sandbox-frame.ts): no origin of its own, no storage, no `import()` of
 * remote code, and no network unless the plugin's switch allows it. The
 * host enforces time limits by tearing the frame down. What the plugin gets
 * is the same API a disk plugin gets in Node — TypeBox, the shared plugin
 * factory, the shared schema packages — through a `require` that knows
 * nothing else.
 */
import * as typebox from '@sinclair/typebox';
import * as typeboxValue from '@sinclair/typebox/value';
import * as shared from '@json-to-office/shared';
import * as sharedPlugin from '@json-to-office/shared/plugin';
import * as sharedDocx from '@json-to-office/shared-docx';
import * as sharedPptx from '@json-to-office/shared-pptx';
import {
  describeComponent,
  evaluateCommonJs,
  extractComponent,
  type ComponentLike,
} from './module-shim';
import { PLUGIN_API_MODULE_IDS } from './type-shims';
import {
  NETWORK_OFF_MARKER,
  type PluginRenderWarning,
  type SandboxRequest,
  type SandboxResponse,
} from './types';

const scope = globalThis as unknown as {
  postMessage: (message: unknown) => void;
  addEventListener: (
    type: 'message',
    listener: (event: { data: SandboxRequest }) => void
  ) => void;
};

// Captured before hardening: the plugin may shadow the global, the runtime
// keeps its own handle.
const post = scope.postMessage.bind(scope);

/** The plugin API every documented import path resolves to. */
const pluginApi = {
  createComponent: sharedPlugin.createComponent,
  createVersion: sharedPlugin.createVersion,
  resolveComponentVersion: sharedPlugin.resolveComponentVersion,
  ComponentValidationError: sharedPlugin.ComponentValidationError,
  DuplicateComponentError: sharedPlugin.DuplicateComponentError,
};

const MODULES: Record<string, unknown> = {
  '@sinclair/typebox': typebox,
  '@sinclair/typebox/value': typeboxValue,
  '@json-to-office/shared': shared,
  '@json-to-office/shared/plugin': sharedPlugin,
  '@json-to-office/shared-docx': sharedDocx,
  '@json-to-office/shared-pptx': sharedPptx,
  ...Object.fromEntries(PLUGIN_API_MODULE_IDS.map((id) => [id, pluginApi])),
};

/**
 * Globals the runtime takes away before the plugin runs.
 *
 * The real boundary is the frame's Content-Security-Policy and its opaque
 * origin (sandbox-frame.ts); this list is the second line, and the one that
 * gives a plugin a readable answer. Storage and messaging go because the
 * plugin has no business persisting or talking across tabs; `close` because a
 * worker that ends itself mid-render would look like a hang.
 */
const STORAGE_AND_MESSAGING = [
  'importScripts',
  'Worker',
  'SharedWorker',
  'indexedDB',
  'caches',
  'BroadcastChannel',
  'FileSystemHandle',
  'FileSystemFileHandle',
  'FileSystemDirectoryHandle',
  'showOpenFilePicker',
  'showSaveFilePicker',
  'showDirectoryPicker',
  'close',
];
const NETWORK = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'WebTransport',
];

/**
 * Remove a global along the whole prototype chain: an own property shadowing
 * `fetch` would still leave `Object.getPrototypeOf(self).fetch` reachable.
 */
function removeGlobal(name: string, replacement?: unknown): void {
  let target: unknown = globalThis;
  while (target && target !== Object.prototype) {
    if (Object.prototype.hasOwnProperty.call(target, name)) {
      try {
        delete (target as Record<string, unknown>)[name];
      } catch {}
    }
    target = Object.getPrototypeOf(target);
  }
  try {
    Object.defineProperty(globalThis, name, {
      value: replacement,
      configurable: false,
      writable: false,
    });
  } catch {}
}

/**
 * A stand-in for a network API: a callable that is also constructible, so
 * both `fetch(url)` and `new WebSocket(url)` reach the same explanation.
 */
function networkOff(name: string): unknown {
  const message = `${NETWORK_OFF_MARKER} ${name} is not available: Network is off for this plugin. Turn on Network in the plugin header to allow it.`;
  return new Proxy(function () {}, {
    apply() {
      throw new Error(message);
    },
    construct() {
      throw new Error(message);
    },
    get(_target, property) {
      if (property === 'name') return name;
      throw new Error(message);
    },
  });
}

let hardened = false;
function harden(allowNetwork: boolean): void {
  if (hardened) return;
  hardened = true;
  for (const name of STORAGE_AND_MESSAGING) removeGlobal(name);
  const nav = (globalThis as unknown as { navigator?: object }).navigator;
  if (nav) {
    for (const property of ['storage', 'locks', 'serviceWorker']) {
      try {
        Object.defineProperty(nav, property, { value: undefined });
      } catch {}
    }
  }
  if (!allowNetwork) {
    for (const name of NETWORK) removeGlobal(name, networkOff(name));
    if (nav) {
      try {
        Object.defineProperty(nav, 'sendBeacon', {
          value: networkOff('navigator.sendBeacon'),
        });
      } catch {}
    }
  }
}

/** A render whose JSON would not fit a message, or a document, sensibly. */
const MAX_RENDER_BYTES = 5 * 1024 * 1024;

let component: ComponentLike | null = null;

function fail(id: number, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const response: SandboxResponse = {
    id,
    type: 'error',
    message,
    ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
  };
  post(response);
}

async function handle(request: SandboxRequest): Promise<void> {
  if (request.type === 'load') {
    harden(request.allowNetwork);
    const exports = evaluateCommonJs(request.js, MODULES);
    const found = extractComponent(exports);
    if (!found) {
      throw new Error(
        'No component export found. Export the result of createComponent() as the default export or under a name ending in "Component".'
      );
    }
    component = found;
    const metadata = describeComponent(found, request.format, request.examples);
    const response: SandboxResponse = {
      id: request.id,
      type: 'loaded',
      metadata,
    };
    post(response);
    return;
  }

  if (request.type === 'render') {
    if (!component) throw new Error('Plugin is not loaded');
    const entry = sharedPlugin.resolveComponentVersion(
      component.name,
      component.versions as never,
      request.version
    );
    const validation = sharedPlugin.validateCustomComponentProps(
      entry.propsSchema,
      request.props,
      { componentName: component.name }
    );
    if (!validation.valid) {
      throw new sharedPlugin.ComponentValidationError(
        validation.errors ?? [],
        request.props
      );
    }
    const warnings: PluginRenderWarning[] = [];
    const addWarning = (
      message: string,
      context?: Record<string, unknown>
    ): void => {
      warnings.push({ message, ...(context ? { context } : {}) });
    };
    const result = await entry.render({
      props: validation.data,
      theme: request.theme,
      addWarning,
      children: request.children,
    });
    const components = Array.isArray(result) ? result : [result];
    // Round-trip through JSON so a plugin returning class instances, functions
    // or cyclic structures fails here with a clear message rather than in
    // postMessage's structured clone.
    const json = JSON.stringify(components);
    if (json.length > MAX_RENDER_BYTES) {
      throw new Error(
        `render() returned ${Math.round(json.length / 1024 / 1024)} MB of components; the limit is ${MAX_RENDER_BYTES / 1024 / 1024} MB.`
      );
    }
    const serializable = JSON.parse(json);
    const response: SandboxResponse = {
      id: request.id,
      type: 'rendered',
      components: serializable,
      warnings,
    };
    post(response);
    return;
  }
}

scope.addEventListener('message', (event) => {
  const request = event.data;
  if (
    !request ||
    typeof request !== 'object' ||
    typeof request.id !== 'number'
  ) {
    return;
  }
  handle(request).catch((error) => fail(request.id, error));
});
