/**
 * The boundary a plugin runs behind.
 *
 * An `<iframe sandbox="allow-scripts">` with no `allow-same-origin` has an
 * opaque origin: nothing inside it can read the playground's storage, send
 * its cookies or call its API as the user. The frame's own document carries a
 * Content-Security-Policy, and the worker it spawns from a blob: URL inherits
 * that policy — so `import()` of a remote script, `fetch`, WebSockets and
 * WebTransport are refused by the browser itself, not by a list of globals
 * the runtime tried to delete. `connect-src` is the one knob, and it names
 * the plugin's own origins: `'none'` until its Network switch is on and its
 * allowlist has something in it (network-policy.ts).
 *
 * The page talks to the frame with `postMessage`; the frame relays to the
 * worker. Only messages from this frame's window are accepted back.
 */
import { connectSrcValue } from './network-policy';

export interface SandboxFrameOptions {
  /** The bundled runtime script (virtual:jto-sandbox-runtime). */
  runtime: string;
  allowNetwork: boolean;
  /** Origins the switch grants; empty reaches nothing. */
  networkOrigins?: readonly string[];
  onMessage: (data: unknown) => void;
  onError: (message: string) => void;
}

function nonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The frame's document. Everything is inline and nonce-bound: the frame has
 * no origin to load anything else from, and the policy says so.
 */
export function sandboxDocument(
  scriptNonce: string,
  allowNetwork: boolean,
  networkOrigins?: readonly string[]
): string {
  const csp = [
    "default-src 'none'",
    // blob: for the worker script; 'unsafe-eval' because the runtime turns
    // the plugin's compiled CommonJS into a function. No host, so the
    // worker cannot import() code from anywhere.
    `script-src 'nonce-${scriptNonce}' blob: 'unsafe-eval'`,
    'worker-src blob:',
    // Built by network-policy.ts, which re-validates every origin: the value
    // lands inside the policy, so nothing reaches it unparsed.
    `connect-src ${connectSrcValue(allowNetwork, networkOrigins)}`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"></head><body><script nonce="${scriptNonce}">
(function () {
  var worker = null;
  window.addEventListener('message', function (event) {
    if (event.source !== window.parent) return;
    var message = event.data;
    if (!message || typeof message !== 'object') return;
    if (message.type === 'init') {
      if (worker) return;
      var url = URL.createObjectURL(new Blob([message.runtime], { type: 'text/javascript' }));
      worker = new Worker(url);
      worker.onmessage = function (reply) { window.parent.postMessage(reply.data, '*'); };
      worker.onerror = function (error) {
        window.parent.postMessage({ type: 'workerError', message: (error && error.message) || 'Worker error' }, '*');
      };
      window.parent.postMessage({ type: 'ready' }, '*');
      return;
    }
    if (worker) worker.postMessage(message);
  });
})();
</script></body></html>`;
}

export class SandboxFrame {
  private readonly iframe: HTMLIFrameElement;
  private readonly ready: Promise<void>;
  private readonly listener: (event: MessageEvent) => void;
  private disposed = false;

  constructor(options: SandboxFrameOptions) {
    const scriptNonce = nonce();
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.setAttribute('title', 'Plugin sandbox');
    iframe.tabIndex = -1;
    iframe.style.cssText =
      'position:absolute;width:0;height:0;border:0;visibility:hidden;pointer-events:none;';
    this.iframe = iframe;

    let resolveReady: () => void = () => {};
    let rejectReady: (error: Error) => void = () => {};
    this.ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    // A frame that never answers would leave every request waiting on it.
    const readyTimer = setTimeout(() => {
      rejectReady(new Error('Plugin sandbox did not start'));
    }, 10_000);

    this.listener = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow) return;
      const data = event.data as { type?: unknown; message?: unknown } | null;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'ready') {
        clearTimeout(readyTimer);
        resolveReady();
        return;
      }
      if (data.type === 'workerError') {
        options.onError(
          typeof data.message === 'string' ? data.message : 'Worker error'
        );
        return;
      }
      options.onMessage(data);
    };
    window.addEventListener('message', this.listener);

    iframe.addEventListener('load', () => {
      iframe.contentWindow?.postMessage(
        { type: 'init', runtime: options.runtime },
        '*'
      );
    });
    iframe.srcdoc = sandboxDocument(
      scriptNonce,
      options.allowNetwork,
      options.networkOrigins
    );
    document.body.appendChild(iframe);
    // Nobody awaits `ready` before the first post; surface a start failure
    // there rather than as an unhandled rejection here.
    this.ready.catch(() => {});
  }

  async post(message: unknown): Promise<void> {
    await this.ready;
    if (this.disposed) throw new Error('Plugin sandbox was closed');
    this.iframe.contentWindow?.postMessage(message, '*');
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener('message', this.listener);
    this.iframe.remove();
  }
}
