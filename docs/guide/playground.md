# Playground

The playground is a visual, browser-based environment for authoring json-to-office documents: a schema-aware JSON editor on the left, a live preview on the right, and one-click export to a real `.docx` or `.pptx`. You can use the hosted playgrounds immediately, or run the same app locally with the `jto` CLI.

![The json-to-office playground: JSON editing on the left, live preview on the right](../playground.gif)

## Hosted playgrounds

| Format | URL                                                                |
| ------ | ------------------------------------------------------------------ |
| DOCX   | [https://docx.json-to-office.com](https://docx.json-to-office.com) |
| PPTX   | [https://pptx.json-to-office.com](https://pptx.json-to-office.com) |

Both are deployments of the exact same dev server you get with `jto docx dev` / `jto pptx dev` — nothing playground-specific is closed source. The hosted instances ship with the AI assistant disabled; running locally gives you the full feature set.

## What it offers

- **Monaco JSON editor with schema autocomplete.** The editor is Monaco (the VS Code editor) wired to the generated JSON Schemas, so you get autocomplete for component names and props, inline validation errors, and hover documentation as you type. See [Validation](/guide/validation) for how the same schemas are used outside the playground.
- **Document outline.** The sidebar shows a semantic table of contents for the active document — numbered slides labeled by their titles (PPTX), the heading hierarchy (DOCX), or top-level keys (themes). Clicking a node jumps the editor to its JSON; moving the cursor highlights the node you're in. Nodes with validation errors get a red dot, and slides or whole heading sections can be reordered by dragging them in the outline.
- **Live preview.** The preview re-renders as the JSON changes, so you iterate on layout and content without a download-open-check loop.
- **Template gallery.** Built-in starting templates for each format, so you never begin from an empty `{}`. Browse them in the document sidebar and use them as a base for your own documents.
- **Theme switching.** Swap the document's theme and watch colors, fonts, and component defaults change instantly. See [Themes & styling](/guide/themes).
- **Compare (DOCX only).** The Compare button diffs two document JSONs into a redline `.docx` with native Word tracked changes — the same engine as `jto docx diff` and `POST /api/docx/diff`. See [the CLI guide](/guide/cli) for the command-line equivalent.
- **Download with font-mode prompt.** When you export a document that references fonts outside the safe list, a dialog asks how to handle them: **keep custom fonts** (references ship as-is; recipients without the font get a fallback) or **convert to safe fonts** (non-safe families are rewritten to Calibri / Georgia / Consolas so every recipient sees the same glyphs). This mirrors the library's `fonts.mode` option — see [Fonts](/guide/fonts).

![Playground screenshot](../playground-screenshot.png)

## High-fidelity PDF preview (LibreOffice)

The default preview is fast but approximate. If headless LibreOffice is installed on the machine running the server, the playground can additionally render your document to PDF through LibreOffice for a high-fidelity preview.

This matters most for PPTX: there is no browser-based renderer for PowerPoint files, so a LibreOffice PDF is the only way to get pixel-accurate output before opening the file in PowerPoint itself.

Two details worth knowing:

- **Staged fonts.** Before invoking LibreOffice, the server registers your document's resolved fonts with the OS — Google Fonts fetched from the built-in catalog (and disk-cached), plus any fonts you registered via `--font` or `--fonts-dir`. This makes the PDF preview show the actual typefaces. It never changes the exported document's bytes; generated files never embed fonts.
- **Graceful absence.** LibreOffice is optional. Without it, the preview endpoints return a 503 and the playground falls back to the standard preview. Point the server at a specific binary with the `LIBREOFFICE_PATH` environment variable if it is not on your `PATH`.

## AI assistant

The playground includes a built-in AI chat assistant powered by Claude. It can generate documents from a brief, edit the current document, or rework a selection, with format-specific system prompts for DOCX and PPTX.

- **Models:** `opus` (default), `sonnet`, or `haiku`, selectable from the chat panel.
- **Authentication:** the server uses `ai-sdk-provider-claude-code`, which reuses your local [Claude Code](https://www.anthropic.com/claude-code) authentication. There is no API key to configure — if Claude Code works on your machine, the assistant works too.
- **Attachments:** images are passed to the model natively; PDF, text, markdown, CSV, and HTML attachments have their text extracted and included in context.
- **Disabling it:** set `AI_ENABLED=false` on the server to unmount the `/api/ai` routes entirely (the hosted playgrounds run this way, with `VITE_AI_ENABLED=false` also hiding the UI at build time).

::: info
The AI assistant and LibreOffice previews are playground-only extras. The core generation libraries have zero dependency on either — see [Architecture](/guide/architecture). For using json-to-office _from_ an LLM in your own pipeline, see [LLM integration](/guide/llms).
:::

## Running locally

The playground ships in the full CLI package, `@json-to-office/jto`:

```bash
pnpm add --global @json-to-office/jto

jto docx dev   # DOCX playground on http://localhost:3003
jto pptx dev   # PPTX playground on http://localhost:3004
```

On start, the CLI prints the local URL, the generation API URL (`http://localhost:<port>/api/<format>/generate`), and the health endpoint (`/health`).

| Flag                  | Default                       | Description                                                                  |
| --------------------- | ----------------------------- | ---------------------------------------------------------------------------- |
| `-p, --port <port>`   | `3003` (docx) / `3004` (pptx) | Server port. `-p` > config-file `server.port` > `PORT` > the format default. |
| `-H, --host <host>`   | `localhost`                   | Bind host.                                                                   |
| `-o, --open`          | off                           | Open the browser automatically.                                              |
| `-c, --config <path>` | —                             | Path to a config file.                                                       |

::: tip
The lean `@json-to-office/jto-cli` package deliberately excludes the playground (no React, Monaco, Vite, or AI dependencies) to stay small for CI and serverless use. Running `jto-cli docx dev` prints a pointer to install `@json-to-office/jto` instead. See [the CLI guide](/guide/cli).
:::

The dev server also exposes an HTTP API (`/generate`, `/validate`, `/diff`, LibreOffice previews, discovery, fonts, and more) that you can call directly — the full route list is in the [CLI reference](/reference/cli). For deploying the playground and its rendering backends, see [Render server & deployment](/guide/render-server).
