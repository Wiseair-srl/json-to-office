# The design loop on Claude Desktop

The [MCP server](/guide/mcp-server) works with nothing configured. This page is
about the configuration that makes the _whole_ loop work on one machine —
author, validate, look at the rendered pages, draw real charts, ship the file —
which is what you want when you are asking for a document you intend to send to
someone.

Everything here is local. The only thing that can leave your machine is chart
data, and only if you point the export server somewhere else; that is the last
section, and it is the one worth reading before you use `highcharts` for a
client document.

## One entry, four settings

```json
// ~/Library/Application Support/Claude/claude_desktop_config.json  (macOS)
// %APPDATA%\Claude\claude_desktop_config.json                      (Windows)
{
  "mcpServers": {
    "json-to-office": {
      "command": "npx",
      "args": ["-y", "@json-to-office/mcp-server"],
      "env": {
        "LIBREOFFICE_PATH": "/Applications/LibreOffice.app/Contents/MacOS/soffice",
        "PDFTOPPM_PATH": "/opt/homebrew/bin/pdftoppm",
        "JTO_OUTPUT_DIR": "/Users/you/Documents/jto-output",
        "JTO_WORKSPACE_DIR": "/Users/you/Library/Application Support/jto-workspaces",
        "HIGHCHARTS_SERVER_URL": "http://localhost:7801"
      }
    }
  }
}
```

Restart Claude Desktop after editing the file.

**`LIBREOFFICE_PATH` and `PDFTOPPM_PATH`** exist because Claude Desktop does not
inherit your shell's `PATH`. Both binaries are usually on it and invisible to
the app anyway, which is the single most common reason `jto_preview` reports a
missing dependency on a machine that plainly has LibreOffice installed.

```bash
brew install --cask libreoffice && brew install poppler     # macOS
sudo apt-get install libreoffice poppler-utils              # Debian/Ubuntu
which soffice pdftoppm                                      # the paths to paste
```

**`JTO_OUTPUT_DIR`** is where generated files and previews land. Point it
somewhere you will actually look — the default is a temporary directory, and a
report you meant to send is not a thing to go hunting for. Everything the server
writes stays inside it; a name that is absolute, contains `..` or escapes
through a symlink is refused before anything touches the disk.

**`JTO_WORKSPACE_DIR`** makes workspaces outlive the connection. Without it, a
document held server-side is lost when Claude Desktop restarts mid-edit — which
it does, on update. With it, the handle still resolves afterwards.

## Verify it, don't assume it

Ask Claude to call `jto_info` with preview dependencies, or check the fields
yourself:

```jsonc
{
  "previewDependencies": {
    "libreoffice": { "available": true, "path": "/Applications/..." },
    "pdftoppm": { "available": true, "path": "/opt/homebrew/bin/pdftoppm" },
    "highchartsExportServer": {
      "available": true,
      "url": "http://localhost:7801",
    },
  },
  "outputRoot": { "path": "/Users/you/Documents/jto-output" },
}
```

All three `available: true` is the fully working loop. `libreoffice` and
`pdftoppm` must **both** be true for `jto_preview` to render anything; the
export server is needed only by the `highcharts` component, and is needed at
generation time, not only for preview.

Everything else — discovery, validation, generation of documents without
`highcharts`, diffs, workspaces — works with none of it, because generation
writes OOXML directly and never launches an office suite.

## Charts, and what leaves your machine

The `highcharts` component renders through a [Highcharts Export
Server](https://github.com/highcharts/node-export-server): json-to-office POSTs
the **complete chart configuration, including every data point**, and gets a PNG
back. That is the whole confidentiality question in one sentence — whatever is
in the chart goes to whatever URL is configured.

**Run it locally.** For client or confidential documents this is the default and
should stay the default:

```bash
npx puppeteer browsers install chrome-headless-shell   # once; it needs a browser
npx highcharts-export-server --enableServer true       # listens on :7801
```

`http://localhost:7801` is where the server looks when nothing is configured, so
a local export server needs no setting at all. Naming it explicitly in the
config is still worth it: it documents the choice, and `jto_info` then reports
the URL it will actually use.

**A private server** — one on your own network or VPN, at an RFC 1918 address or
an internal hostname — is the same posture at team scale, and takes the same
setting with a different URL.

**A hosted endpoint is an explicit decision**, not a default. Pointing
`HIGHCHARTS_SERVER_URL` at a third-party service means every figure in every
chart is transmitted to it. Before doing that for anything with a client's data
in it, know: what the endpoint retains and for how long, whether requests are
logged, whether the connection is TLS end to end, and who else can reach it. If
you cannot answer those, run it locally — it is one command.

### When the server is down

Generation fails. It does not draw an empty box or silently drop the chart:

```
Error: Highcharts Export Server is not running at http://localhost:7801.
Start it with: npx highcharts-export-server --enableServer true
```

That is deliberate. A document that quietly lost its charts is worse than one
that was not produced, because only the second is obvious. The
[design-evals harness](https://github.com/Wiseair-srl/json-to-office/tree/main/packages/design-evals)
counts a run that failed this way as **not shippable** and keeps it in the
denominator, for the same reason.

### Fallbacks

| Instead of `highcharts` | Gets you                                                              | Costs you                                           |
| ----------------------- | --------------------------------------------------------------------- | --------------------------------------------------- |
| `chart`                 | A real, editable Word/PowerPoint chart. No server, no network at all. | docx needs `renderer: "office-open"`; 8 chart types |
| `visual`                | A pptx slide rendered into the document by LibreOffice.               | Needs LibreOffice; a picture, not a chart           |

Reach for native [`chart`](/guide/charts) first: it needs no infrastructure, the
recipient can edit the data, and it covers the common business chart types.
`highcharts` earns its dependency when you need a chart type or a treatment an
Office chart cannot express. Both are demonstrated in
[`examples/`](https://github.com/Wiseair-srl/json-to-office/tree/main/examples):
`native-chart.docx.json`, `native-visual.docx.json`, and
`highcharts-report.docx.json`.

### What the theme does and does not reach

`examples/highcharts-report.docx.json` is the one to render when you want to see
this. It uses the `vermilion` theme and adds `accent4`–`accent6` through
`themeOverrides`.

**The palette carries.** With no `options.colors` set, the series are painted
from the theme in token order — `primary`, `secondary`, `accent`, `accent4`,
`accent5`, `accent6` — so the four series come out near-black, grey, vermilion
and sage, and the chart belongs to the document. The built-in DOCX themes define
only the first three; the fourth series in this example is coloured because the
document adds `accent4` itself. An explicit `options.colors` always wins and
nothing is injected.

**The fonts do not.** The chart is a PNG rendered by a browser that knows
nothing about the document: axis labels, the chart title and the legend come out
in the export server's own default face, not the theme's. In a rendered page
that reads as a chart set in a different typeface from the prose around it,
which is a real coherence defect and not a bug in the export. Two ways out:
inject `@font-face` CSS through the component's `resources` prop (see
[Custom fonts in Highcharts output](/guide/charts#custom-fonts-in-highcharts-output)),
or set the chart's typography explicitly in `options` to a family the export
server has. The same applies to type sizes: Highcharts' defaults are not the
document's type scale. Making this automatic is
[issue #354](https://github.com/Wiseair-srl/json-to-office/issues/354).

## Related

- [The MCP server](/guide/mcp-server) — the tools, the resources, where files go.
- [Charts](/guide/charts) — native versus Highcharts, the palette rules, custom fonts.
- [Design quality](/guide/design-quality) — the findings `jto_validate` reports and how to read them.
