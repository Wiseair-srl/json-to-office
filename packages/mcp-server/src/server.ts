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
import { register as registerScaffold } from './tools/scaffold.js';
import { register as registerValidate } from './tools/validate.js';
import { register as registerGenerate } from './tools/generate.js';
import { register as registerPreview } from './tools/preview.js';
import { register as registerDiff } from './tools/diff.js';
import { register as registerWorkspace } from './tools/workspace.js';
import { register as registerResources } from './resources/index.js';

/**
 * The server's own prompt, surfaced to the client at initialize.
 *
 * Two jobs, and the second is the newer one. It states the invariants an agent
 * gets wrong without being told — that the JSON is the artifact and the file a
 * build product, that large rewrites lose more than they fix, that looking at
 * a rendered page beats reasoning about whether a layout worked (#271). And it
 * names the design workflow, because the failure this server was losing to was
 * not a wrong call: it was an agent left to decide look, structure and layout
 * alone at every node, and picking the safe generic option each time (#324).
 *
 * The workflow names the path end to end. When a step was still unbuilt it
 * said so, so an agent that knew the shape of the path took the parts that
 * existed rather than inventing a different route — and the sentence written
 * for jto_scaffold before it landed (#339) is the one it was designed against.
 *
 * One screen. Every line an agent skips is a line that may as well not exist.
 */
export const SERVER_INSTRUCTIONS = `Author Microsoft Word (.docx) and PowerPoint (.pptx) documents as JSON.

The JSON is authoritative. A generated file is a build product of the document JSON plus a renderer, a theme, fonts, assets and options — edit the JSON and regenerate; never treat the binary as the source.

Design workflow — theme, structure, fill, check, ship:
1. THEME. Pick one with jto_discover and set it on the document root. A document that names no theme inherits defaults nobody chose, and that is what generic output looks like.
2. STRUCTURE. Choose the archetype before the content. For a report, jto_scaffold is the first move: name a blueprint from jto_discover, the theme and the facts of the brief, and it opens a draft workspace with every section and block in place and a fill map of the slots still owed. Where no blueprint fits, decide the sections or slides explicitly rather than growing the document node by node.
3. FILL. Write content into that structure — by fill-map pointer with jto_workspace_patch when you scaffolded. Prefer named styles and theme colour tokens over raw sizes and hex, so a theme swap restyles the whole document instead of half of it. Every component's design note in jto_discover says what good use of it looks like.
4. CHECK. jto_validate after each edit, then jto_preview when the question is visual. jto_preview with contactSheet: true tiles every page into one image — the way to see whether the deck holds together.
5. SHIP. jto_generate. It refuses a document that still carries an unfilled {{…}} scaffold slot; jto_validate says generationReady when none remains.

Working rules:
- Discover before authoring. Call jto_info first, then jto_discover and jto_describe_component (or read the jto:// resources) for the components, renderer ids and design notes a format actually supports.
- Make small edits. With a workspace handle, patch precisely (RFC 6902 over RFC 6901 paths) instead of resending the whole document; without one, change one region at a time.
- Validate often. Run jto_validate after each edit rather than once at the end; diagnostics are path-addressed, so they map straight back onto the JSON you just changed.
- Treat design findings as defects. Schema-valid is not well-designed. jto_validate lints layout, legibility and brand as W_QUALITY_* findings: undeclared slide canvas, text overflowing its box, overcrowded slides, table widths past their section, leftover placeholder text, unfilled scaffold slots, opaque boxes covering each other, more than three font families, colours off the theme palette. They rarely block generation, but they almost always show in the rendered result — repair them like errors, and apply the RFC 6902 fix when a finding carries one.
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
  registerScaffold(server, deps);
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
