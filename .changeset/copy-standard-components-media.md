---
'@json-to-office/jto': patch
---

Fix "Copy standard components" 400 for documents referencing bundled media.

In safe mode, `/standard-components` validated the raw definition against the
outbound-source policy, so any discovered document referencing relative
`media/...` paths was rejected with a 400 — while `/generate` accepted the same
document because it inlines discovered media first. The route now mirrors
`/generate`'s prologue (sourceName → baseDir → inline media before source
validation) and passes `customThemes` through as a theme registry instead of
forcing the first custom theme. The playground client now sends
`options.sourceName` and the current custom themes with the request, and reads
the server's `error` field so the toast shows the real failure reason instead
of "Request failed with status 400".
