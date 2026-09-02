/// <reference types="vite/client" />

declare const __AI_ENABLED__: boolean;

/**
 * Type declarations for the in-browser plugin editor, keyed by the virtual
 * `node_modules/<pkg>/<file>` path Monaco resolves them at. Emitted by the
 * `jto-plugin-type-libs` plugin in vite.config.ts.
 */
declare module 'virtual:jto-plugin-type-libs' {
  const libs: Record<string, string>;
  export default libs;
}

/**
 * The plugin sandbox runtime (lib/plugins/sandbox.worker.ts and everything
 * it imports) bundled into one script, handed to the sandbox iframe as text.
 * Emitted by the `jto-sandbox-runtime` plugin in vite.config.ts.
 */
declare module 'virtual:jto-sandbox-runtime' {
  const runtime: string;
  export default runtime;
}

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_IMAGEKIT_PUBLIC_KEY: string;
  readonly VITE_IMAGEKIT_PRIVATE_KEY: string;
  readonly VITE_IMAGEKIT_URL_ENDPOINT: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
