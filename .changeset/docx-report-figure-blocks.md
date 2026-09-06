---
'@json-to-office/shared': minor
'@json-to-office/core-docx': minor
'@json-to-office/core-pptx': minor
'@json-to-office/jto-ops': minor
'@json-to-office/jto': minor
'@json-to-office/mcp-server': minor
---

The report's figures as JSON blocks in the `client-report-blocks` playground template: `chart-figure` (a `highcharts` chart — or a native `chart` on office-open — with a caption, an optional takeaway and a required source), `figure` (an image or visual with caption and source) and `footnotes` (a "Notes and sources" list of every distinct source the document's blocks cite; nothing when there is none). Figures and charts number together.

Two engine capabilities carry them. `{SEQ:name}` in paragraph text is a Word `SEQ` field the compiler also counts, so `Figure {SEQ:figure}.` reads 1, 2, 3 in document order in Word, headless LibreOffice and the preview PDF alike; both renderers write it. A DOCX block context exposes `/sources`, the ordered, de-duplicated `source`-role slot values across the document, each mapped back to the slot it was written in. A chart a block places is annotated by that block's `takeaway`/`source` slots, so `W_QUALITY_CHART_ANNOTATION` no longer asks for a caption inside it; chart findings keep authored paths.

Chart data leaves the process only on purpose. A Highcharts export server the address does not prove private (loopback, RFC 1918, link-local or unique-local literals, `localhost`, `.local`, `.internal`, `.home.arpa`) is refused at generation time until `services.highcharts.allowRemote` — `HIGHCHARTS_ALLOW_REMOTE=1` on the CLI, playground and MCP server — and once allowed every generation reports `W_HIGHCHARTS_REMOTE_EXPORT` with the URL, in both formats. The charts guide documents exactly what the export request carries.

The jto-ops format adapters now honour `services` passed to `createGenerator`/`generateBuffer`, service by service over the environment; before, an explicit export server URL was silently dropped in favour of `HIGHCHARTS_SERVER_URL` or the default.
