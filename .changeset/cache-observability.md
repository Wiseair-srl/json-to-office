---
'@json-to-office/core-docx': minor
'@json-to-office/jto-cli': minor
'@json-to-office/jto': patch
---

fix: make cache observability truthful and cross-render caching real (#156)

The Cache Performance modal was structurally blind: component types that
bypass the cache by design recorded nothing, the visual rasterizer's two
caches exposed no stats, per-render date keys killed every cross-render
lookup for date-less documents, repeated `/load-plugins` calls reset the
stats before they meant anything, and "Clear all caches" wasn't.

- `core-docx`: design-bypassed renders are counted per type with a reason
  (`getComponentBypassStats`; included in `getComponentCacheStats`). The
  generation date only joins a component's cache key when its props or
  children reference a date-sensitive placeholder (`{DATE}`, `{DATETIME}`,
  `{YEAR}`, custom registrations — `{PAGE}`/`{TOTAL_PAGES}` are field
  codes and excluded), so date-less components hit across renders. The
  visual pre-pass exports cumulative dedupe counters
  (`getVisualPrepassStats`).
- `jto-cli`: the rasterizer exposes `getRasterizerCacheStats()` (disk
  hits/misses, batch dedupe, rendered/failed, PNG entries and bytes) and
  `clearRasterizerCache()`. `PluginRegistry` fingerprints each loaded set
  (paths + mtimes + sizes): reloading an unchanged set is a no-op — no
  re-import, no cache invalidation — and a changed set invalidates ONCE
  per batch instead of once per plugin.
- `jto`: `/cache-stats` returns the rasterizer block and bypassed-type
  rows; the modal renders "uncached by design" rows and a Visual
  Rasterizer section. `DELETE /cache` now also clears the component
  render cache and the rasterizer PNG disk cache. The client collapses
  concurrent load-plugins calls into one request.
