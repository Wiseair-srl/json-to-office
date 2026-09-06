# The MCP server

`@json-to-office/mcp-server` puts the whole authoring loop behind the [Model Context Protocol](https://modelcontextprotocol.io), so an agent inside Claude Code, Claude Desktop, Cursor or any other MCP host can discover the component model, author JSON, validate it, look at rendered pages, and produce a real `.docx` or `.pptx` — without you wiring any of it up.

It is local and stdio-only: no auth, no hosted endpoint, no network beyond the asset and font services you configure. The agent gets the same generation packages the [CLI](/guide/cli) uses, and the same rule holds — [the JSON is the artifact](/guide/llms), the Office file is a build product of it.

## Install

Nothing to install. Configure your client to run it and the host will fetch it on first use.

::: code-group

```bash [Claude Code]
claude mcp add json-to-office -- npx -y @json-to-office/mcp-server
```

```json [Claude Desktop]
// ~/Library/Application Support/Claude/claude_desktop_config.json  (macOS)
// %APPDATA%\Claude\claude_desktop_config.json                      (Windows)
{
  "mcpServers": {
    "json-to-office": {
      "command": "npx",
      "args": ["-y", "@json-to-office/mcp-server"]
    }
  }
}
```

```json [Cursor]
// ~/.cursor/mcp.json, or .cursor/mcp.json in one project
{
  "mcpServers": {
    "json-to-office": {
      "command": "npx",
      "args": ["-y", "@json-to-office/mcp-server"]
    }
  }
}
```

:::

Any other stdio host takes the same three facts: transport `stdio`, command `npx`, args `["-y", "@json-to-office/mcp-server"]`. Substitute `pnpm` / `["dlx", "@json-to-office/mcp-server"]` if you would rather not go through npm. Pin a version — `@json-to-office/mcp-server@1.0.0` — for anything that has to reproduce later, since the renderer version is part of what a document renders to.

Restart the client after editing a config file. `claude mcp list` will tell you whether Claude Code can reach it.

## Where files go

The server writes everywhere it writes into exactly one directory, and nowhere else — a file name that is absolute, contains `..`, or slips out through a symlink is refused before anything touches the disk.

| Setting               | Effect                                                |
| --------------------- | ----------------------------------------------------- |
| `--output-dir <path>` | The output root. Highest precedence.                  |
| `JTO_MCP_OUTPUT_DIR`  | The same, when the flag is absent.                    |
| _(neither)_           | A per-connection directory under the system temp dir. |

Set one. The default is fine for previews you only look at, but a report you wanted to keep should not land somewhere the OS reaps:

```bash
claude mcp add json-to-office -s user \
  -e JTO_MCP_OUTPUT_DIR=$HOME/Documents/jto-out \
  -- npx -y @json-to-office/mcp-server
```

In Claude Desktop and Cursor the equivalent is an `"env"` object beside `"command"`.

## Workspaces that survive a lost session

A workspace holds a document server-side so the agent patches it instead of resending it. By default it lives in memory and belongs to one connection: whatever ends the connection — a client restart, a host session reset, a crash — takes the open documents with it, however many revisions of authoring they held.

Give the server a workspace directory and every committed revision is mirrored there instead:

```bash
claude mcp add json-to-office -s user \
  -e JTO_MCP_OUTPUT_DIR=$HOME/Documents/jto-out \
  -e JTO_MCP_WORKSPACE_DIR=$HOME/Documents/jto-workspaces \
  -- npx -y @json-to-office/mcp-server
```

| Setting                  | Effect                                                        |
| ------------------------ | ------------------------------------------------------------- |
| `--workspace-dir <path>` | Workspace revisions are mirrored here. Highest precedence.    |
| `JTO_MCP_WORKSPACE_DIR`  | The same, when the flag is absent.                            |
| _(neither)_              | Memory-only handles, ending with the connection. The default. |

After a reconnect the agent calls `jto_workspace_list` and gets its handles back — including ones opened by the connection that died — then reads or patches them as usual. Memory stays the fast path; the disk copy only loads when a handle is actually used. Closing a workspace still destroys it, on disk as well, and a revision that could not be written comes back as a `W_WORKSPACE_NOT_PERSISTED` warning with the edit applied. `jto_info.workspaces.persistent` says which mode a connection is in.

The directory holds document JSON in the clear, so point it somewhere private and check its permissions yourself: the server creates a new root `0o700` and writes files `0o600`, but it leaves an existing directory's permissions alone, and Windows does not enforce those bits. Give each client its own root: two connections sharing one share its handles, and `baseRevision` guards a write against the connection that made it, not against another one editing the same handle at the same time.

## What the agent gets

Thirteen tools and `jto://` resources: nine for discovery, plus a document and a thumbnail for each bundled template. The [package README](https://github.com/Wiseair-srl/json-to-office/tree/main/packages/mcp-server#tools) documents every input and output field; the shape of the loop is:

**Discover.** `jto_info` reports versions, formats, renderer ids, the output root and whether preview can run here. `jto_discover` lists components, renderer profiles, themes and starter documents; `jto_describe_component` returns one component's exact schema, with nested components collapsed to names so nothing pulls a megabyte of schema through the model.

It also lists the **template gallery**: ten designed documents bundled with the package, each with an archetype, a measured page count, a component and slot inventory, and a sentence on when to use it. `jto://templates/<name>` returns the document and `jto://templates/<name>/thumbnail` returns every page tiled into one low-DPI image — worth a look before copying several hundred kilobytes of JSON. Bundled rather than fetched, so the cold path sees a designed document with no network at all. The photographs are deliberately not shipped; each manifest lists the image paths its template expects, so an agent knows to supply its own rather than send someone else's.

**Author and repair.** `jto_validate` returns path-addressed diagnostics — RFC 6901 pointers into the document you sent, usable directly as patch targets. Beside structural errors it reports [design-quality findings](/guide/design-quality) (`W_QUALITY_*`) with category, certainty, and evidence. They advise by default; pass `quality.policy.gate` to make the selected severity block `ok`. Optional workspaces (`jto_workspace_create`, `_inspect`, `_patch`, `_snapshot`, `_list`, `_close`) hold a document server-side so an agent can send an RFC 6902 patch instead of resending the whole tree; with a [workspace directory](#workspaces-that-survive-a-lost-session) configured they outlive the connection.

**Look.** `jto_preview` renders selected pages to PNG and hands them back as image blocks. This is the part that has no CLI equivalent worth the name: a model reasoning about whether a table overflowed is guessing, and a model looking at the page is not.

Pass `contactSheet: true` and it answers with one labelled image tiling every selected page instead. Cross-page questions — does every section opener look like the others, does the rhythm hold, is the footer on all of them — are questions about the set, and asking them one page at a time costs twenty images and answers none of them. The sheet renders at 72 DPI, inlines when it fits one image block, and is written to the output root when it does not: forty pages tile into a sheet too large to survive a client's downscale with its thumbnails still readable, so it is delivered at full size as a file instead.

**Ship.** `jto_generate` writes the real file. `jto_docx_diff` produces a Word redline with native tracked changes between two versions of a document.

Document defects always come back as structured diagnostics with `ok: false` — never as protocol errors, so an agent can read and repair them instead of retrying blind.

## Preview needs two host binaries

`jto_preview` converts with **LibreOffice** and rasterizes with **poppler**:

```bash
brew install --cask libreoffice && brew install poppler      # macOS
sudo apt-get install libreoffice poppler-utils               # Debian/Ubuntu
winget install TheDocumentFoundation.LibreOffice; winget install oschwartz10612.Poppler  # Windows
```

Everything else — discovery, validation, generation, diff, workspaces — works on a host with neither, because generation writes OOXML directly and never launches an office suite. Without them `jto_preview` returns a structured error naming what is missing and how to install it, and `jto_info.previewDependencies` answers the question before the agent spends a call on it.

Claude Desktop does not inherit your shell's `PATH`. If the binaries live somewhere unusual — or even if they don't — name them with `LIBREOFFICE_PATH` and `PDFTOPPM_PATH` in the client's `env` block; [the Claude Desktop guide](/guide/claude-desktop) has the whole entry, including the output and workspace directories and the chart export server.

Preview pixels come from LibreOffice, not Microsoft Office: line breaks, pagination, font substitution and chart rasterization can differ from Word or PowerPoint on the recipient's machine. Treat a preview as a strong indication of layout, not as the final document.

## Related

- [The design loop on Claude Desktop](/guide/claude-desktop) — the configuration that makes preview, charts and durable workspaces work on one machine, and what leaves it.
- [Generating documents with LLMs](/guide/llms) — the schema-and-validate loop this server automates, and how to build it yourself.
- [Using the CLI](/guide/cli) — the same operations for humans and CI.
- [Validation](/guide/validation) — where the diagnostics come from.

## Document-local JSON blocks

Use `jto://blocks` to inspect example definitions extracted from complete playground templates, including slot schemas and source pointers. Copy chosen definitions into the document’s `props.blocks`; the catalog never registers runtime names. The client-report playground template demonstrates all four migrated report compositions and an adaptive metric row.

`jto_workspace_inspect` with `includeBlocks: true` returns that revision’s definitions, derived slot schemas and invocation fill pointers. `jto_validate` with `includeCompiled: true` returns expanded primitives and authored source maps. See [JSON blocks](/reference/blocks) for the contract and breaking changes.
