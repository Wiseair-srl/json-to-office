/**
 * The server, assembled once.
 *
 * Every tool module exposes the same `register(server, deps)` and is listed
 * here in a fixed order, so the modules can be written independently and this
 * file never has to change again as they land. Registration order is the order
 * `tools/list` reports, which is also the order an agent reads them in — hence
 * info, then discovery, then the authoring loop, then workspaces.
 */

import { McpServer } from '@modelcontextprotocol/server';
import type { McpServerFactory } from '@modelcontextprotocol/server';

import type { ToolDeps } from './lib/deps.js';
import { SERVER_NAME } from './lib/version.js';

import { register as registerInfo } from './tools/info.js';
import { register as registerDiscover } from './tools/discover.js';
import { register as registerDescribeComponent } from './tools/describe-component.js';
import { register as registerValidate } from './tools/validate.js';
import { register as registerGenerate } from './tools/generate.js';
import { register as registerPreview } from './tools/preview.js';
import { register as registerDiff } from './tools/diff.js';
import { register as registerWorkspace } from './tools/workspace.js';
import { register as registerResources } from './resources/index.js';

/**
 * The server's own prompt, surfaced to the client at initialize.
 *
 * These are the invariants an agent gets wrong without being told: that the
 * JSON is the artifact and the file is a build product, that large rewrites
 * lose more than they fix, and that looking at a rendered page is cheaper than
 * reasoning about whether a layout worked (#271).
 */
export const SERVER_INSTRUCTIONS = `Author Microsoft Word (.docx) and PowerPoint (.pptx) documents as JSON.

The JSON is authoritative. A generated file is a build product of the document JSON plus a renderer, a theme, fonts, assets and options — edit the JSON and regenerate; never treat the binary as the source.

Working rules:
- Discover before authoring. Call jto_info first, then jto_discover and jto_describe_component (or read the jto:// resources) for the components and renderer ids a format actually supports.
- Make small edits. With a workspace handle, patch precisely (RFC 6902 over RFC 6901 paths) instead of resending the whole document; without one, change one region at a time.
- Validate often. Run jto_validate after each edit rather than once at the end; diagnostics are path-addressed, so they map straight back onto the JSON you just changed.
- Treat design findings as defects. Schema-valid is not well-designed: jto_validate also lints layout and legibility (W_QUALITY_* — undeclared slide canvas, text overflowing its box, overcrowded slides, table widths no page can hold). These never block generation, but they almost always show in the rendered result — repair them like errors.
- Preview when the answer is visual. jto_preview renders pages to PNG; use it whenever layout, overflow or fit is in question, not only before finishing.
- Snapshot before risky changes. jto_workspace_snapshot pins the current revision so a restructuring you cannot cleanly undo is still recoverable.

Document defects come back as structured diagnostics with ok: false, not as errors — read them and repair. Generated files are written under the server's output root and returned as paths; ask for base64 only for small artifacts.`;

/** Build a server with every tool and resource registered. */
export function createServer(deps: ToolDeps): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: deps.serverVersion },
    {
      capabilities: { tools: {}, resources: {} },
      instructions: SERVER_INSTRUCTIONS,
    }
  );

  registerInfo(server, deps);
  registerDiscover(server, deps);
  registerDescribeComponent(server, deps);
  registerValidate(server, deps);
  registerGenerate(server, deps);
  registerPreview(server, deps);
  registerDiff(server, deps);
  registerWorkspace(server, deps);
  registerResources(server, deps);

  return server;
}

/**
 * The factory `serveStdio` wants.
 *
 * It is called once per connection and, on a 2025-era opening, once more for
 * the pinned legacy instance — so it must build a fresh `McpServer` every
 * time. `deps` are deliberately shared: the output root and the workspace
 * store belong to the process, which for stdio is the connection.
 */
export function createServerFactory(deps: ToolDeps): McpServerFactory {
  return () => createServer(deps);
}
