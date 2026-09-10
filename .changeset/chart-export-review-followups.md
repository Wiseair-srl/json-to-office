---
'@json-to-office/shared': minor
'@json-to-office/core-docx': minor
'@json-to-office/core-pptx': minor
---

Follow-ups to the bounded chart export work in 5.4.0, from review.

**The request timeout now covers the response body.** It previously stopped at the headers: `postJsonToService` disarmed the abort and handed back a `Response`, and every caller read the body afterwards with nothing left to interrupt it. A service that answered `200` and then stalled its stream hung the render — the failure the timeout exists to prevent. A failed response's body is now cancelled rather than left undrained, so a document's worth of failures cannot hold that many connections open.

**Duplicate charts no longer occupy the concurrency gate.** The gate sat outside the per-document memo, so copies of one chart held slots while awaiting a render they were not performing: forty repeats of a figure could fill the pool and hold up distinct charts with real work. `maxInFlight` now counts requests open against the server rather than charts waiting their turn.

**The batch rasterize call no longer retries.** Its timeout scales with the chunk (`30000 + 10000 × slides`), so a full 32-slide chunk could spend three 350-second windows — over seventeen minutes — before falling back to per-visual calls. That fallback is the better retry: it degrades to smaller work instead of repeating the same large request.

**API.** These correct plumbing that 5.4.0 exposed from `@json-to-office/shared` rather than a host-facing surface, but the exports did change:

- `postJsonToService` takes a `decode` callback and returns the decoded body instead of a `Response`. The timeout can only cover the body if the client reads it.
- `limitChartRequest`, `dedupeChartRequest` and `chartRequestKey` are replaced by `sendChartRequest`, which composes memo → gate → counter in that order. Composing them by hand in any other order is the bug above, so there is one entry point instead of three primitives.

`services.highcharts` options, defaults, warnings and the `SERVICE_UNAVAILABLE` contract are unchanged.
