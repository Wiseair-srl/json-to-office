---
'@json-to-office/core-docx': minor
'@json-to-office/core-pptx': minor
---

Example plugins: one `weather` component per format, calling a real API.

`weather` now fetches from [Open-Meteo](https://open-meteo.com) instead of returning mock data — a geocoding lookup that turns a city name into coordinates, then the forecast — so the example shows what a plugin that reaches the network actually looks like: a bounded request, the two hosts it needs named in the source, and errors an author can act on (`Open-Meteo has no place called "…"`, rather than a bare `TypeError`). v1 renders the current reading (temperature, feels-like, humidity, wind, pressure, WMO conditions); v2 renders a 1–7 day forecast table with highs, lows and precipitation probability. Both honour `units: metric | imperial`. The DOCX copy now imports the plugin API by package name, the way a plugin in your own project would, so the same file compiles both on disk and in the playground's browser sandbox.

The `columnsLayout`, `nestedSections`, `eldermoor-census` and `text-space-after` example plugins are removed; `weather` is the one worked example. This does not affect the `text-space-after` legacy custom component (`packages/core-docx/src/components/text-space-after.ts`), which is unchanged.
