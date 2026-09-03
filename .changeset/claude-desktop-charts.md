---
'@json-to-office/mcp-server': patch
---

Documents the whole design loop on Claude Desktop, and pins the chart paths with tests.

A new guide covers the configuration that makes preview, durable workspaces and real charts work on one machine — `LIBREOFFICE_PATH` and `PDFTOPPM_PATH` (Claude Desktop does not inherit your shell's `PATH`, which is the usual reason preview reports a missing dependency on a machine that plainly has LibreOffice), `JTO_OUTPUT_DIR`, `JTO_WORKSPACE_DIR`, `HIGHCHARTS_SERVER_URL` — and how to verify each one through `jto_info` rather than assume it.

It is explicit about what leaves the machine. The `highcharts` component POSTs the complete chart configuration, every data point included, to whatever URL is configured. A local server is the default and stays the default for client work; a private server on your own network is the same posture at team scale; a hosted endpoint is a decision to make deliberately, knowing what it retains, for how long, and who else can reach it.

An outage fails generation outright rather than dropping the chart, which the guide states and a new test pins: a document that quietly lost its figures is worse than one that was not produced, because only the second is obvious. The same test proves the two fallbacks need nothing — native `chart` and a native `visual` both generate with no export server reachable at all.

`examples/highcharts-report.docx.json` is committed and was rendered to check what the theme actually reaches. The palette carries: with no `options.colors` the series are painted from the theme in token order, and the fourth series is coloured because the example adds `accent4` through `themeOverrides`, which is what the built-in DOCX themes leave unset. The fonts do not: axis labels, titles and legend come out in the export server's own face at Highcharts' own sizes, so a chart is visibly set in a different typeface from the prose around it. That is a real level-3 coherence defect, documented here with its two workarounds and filed as #354.
