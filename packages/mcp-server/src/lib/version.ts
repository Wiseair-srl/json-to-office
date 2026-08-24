/**
 * Build-time version, injected by tsup's `define`.
 *
 * The `typeof` guard is what makes this work under vitest and `tsx`, where no
 * bundler ran and the identifier is genuinely absent — same shim as
 * `jto-cli`'s `cli.ts`.
 */
declare const __PACKAGE_VERSION__: string | undefined;

export const SERVER_VERSION: string =
  typeof __PACKAGE_VERSION__ !== 'undefined' ? __PACKAGE_VERSION__ : 'dev-mode';

/** MCP `serverInfo.name`. Stable: clients key configuration off it. */
export const SERVER_NAME = 'json-to-office';

/** npm identity, reported by `jto_info` next to the workspace packages. */
export const PACKAGE_NAME = '@json-to-office/mcp-server';
