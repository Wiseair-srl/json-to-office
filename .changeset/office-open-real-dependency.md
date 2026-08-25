---
'@json-to-office/core-docx': minor
'@json-to-office/core-pptx': minor
'@json-to-office/shared': minor
'@json-to-office/jto-ops': minor
'@json-to-office/mcp-server': minor
---

The `office-open` renderer is installed rather than advertised, and every surface
that offers a renderer now says whether it can run.

`@office-open/docx` and `@office-open/pptx` were optional peer dependencies, so on
any install that did not opt in — `npx` above all, where there is no project to
`pnpm add` into — the renderer was listed by `jto_info`, listed per component by
`jto_discover`, validated against by `jto_validate`, and then failed every render.
The `visual` component's `renderMode: "native"` went with it, since that mode is
documented as requiring the backend. They are ordinary dependencies now: ESM-only,
no native code, no install scripts, 7.4 MB.

Availability is reported as well as fixed, because an `--omit=optional` install or
a broken tree can still produce the same gap:

- `RendererRegistry.statuses()` loads each registered renderer once, memoized, and
  reports `{ id, default, available, reason, installHint }`. Exposed as
  `docxRendererStatuses()` / `pptxRendererStatuses()` and as `rendererStatuses()`
  on the format adapters.
- `jto_info` returns `formats[].renderers[]` beside the existing `rendererIds`,
  and warns with the install line for any renderer that cannot load.
- `jto_discover` marks each renderer profile `available`.
- `jto_validate` warns when the profile a document will actually build with has no
  backend, instead of returning a clean result that the next call contradicts.

Two error-reporting fixes alongside it:

- `jto_preview` classified a missing backend as a generic build failure and
  suggested "a build failure is a defect in the JSON, not in the renderer" —
  sending the caller to validate a document that was never at fault. It now
  returns `E_DEPENDENCY_MISSING`, as `jto_generate` already did, and skips the
  validation pass that only added noise.
- An internal failure no longer puts `error.stack` — absolute filesystem paths and
  module layout — into the tool result, where it reached whatever transcript the
  client keeps. Set `JTO_MCP_DEBUG_STACKS=1` to restore it.
