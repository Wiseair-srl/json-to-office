---
'@json-to-office/shared': minor
'@json-to-office/core-docx': minor
'@json-to-office/core-pptx': minor
'@json-to-office/json-to-docx': minor
'@json-to-office/json-to-pptx': minor
---

`services.highcharts.acceptImage` lets a host refuse a chart image the export server returned with a 2xx, and have it retried like a failure the server could not answer. It is called with `{ image, mediaType: 'png', options, scale?, attempt }` — the decoded PNG bytes, the Highcharts options that were posted (the request's `infile`) and the post number — and may return a promise. `false` re-posts the same request from the same `retries` budget with the same backoff; a throw fails the generation with that error. When the budget runs out on a refused image, the last one is embedded and a `W_CHART_IMAGE_REJECTED` warning names the chart and the attempts: in docx `context: { code, standardPath, kind, id?, attempts, serverUrl }`, matching the render manifest's `standardPath`; in pptx `slide` and `context: { path, id?, attempts, serverUrl }`. A refused image is never cached or shared with an identical chart in the same document. `getChartRequestStats()` gains `rejectedRetries`; `PipelineWarning` gains an optional `context`. The library ships no check of its own: without `acceptImage`, requests, retries and output are unchanged. Docx and pptx now post charts through one shared `exportChartImage`.
