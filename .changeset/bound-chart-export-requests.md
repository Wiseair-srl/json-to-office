---
'@json-to-office/shared': minor
'@json-to-office/core-docx': minor
'@json-to-office/core-pptx': minor
---

Bound, retry and deduplicate Highcharts export-server requests.

Chart rendering used to fan out: the docx document walk and the pptx slide expansion both resolve siblings with `Promise.all`, so every chart in a document was posted to the export server at once. Against a self-hosted server with a single Puppeteer worker that queued every request behind the first while all of them counted down their own 30s abort.

**Behaviour change for every caller.** Chart requests are now bounded at four in flight per export server URL — process-wide, so several documents generated together share the cap — and a request the server could not answer (timeout, refused connection, 429, 5xx) is retried twice with jittered exponential backoff. Any other 4xx still fails on the first attempt with the message it always had. A chart identical to one already rendered in the same document is requested once and its PNG reused.

New `services.highcharts` options, all optional and all defaulting to the previous behaviour where there was one:

- `concurrency` (default `4`)
- `timeoutMs` (default `30000`, previously hard-coded)
- `retries` (default `2`)

The pptx chart path now uses the same HTTP client as docx, so it finally has a request timeout; its `SERVICE_UNAVAILABLE` code and message are unchanged. That timeout now covers reading the response body as well as receiving its headers, so a service that answers and then stalls its stream is reported as the outage it is rather than hanging the render. `getChartRequestStats()` / `resetChartRequestStats()` report charts collected, unique requests, retries spent and peak in-flight. The `W_HIGHCHARTS_REMOTE_EXPORT` notice is now recorded once per export server rather than once per chart.
