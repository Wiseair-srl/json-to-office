---
'@json-to-office/jto-cli': patch
---

fix(cli): forward `--no-google-fonts` to the generator

`generate` read `options.noGoogleFonts`, a key Commander never sets: a `--no-x` flag is delivered as `options.x === false`. The condition was therefore never true and the flag was inert. It now sets `fonts.googleFonts.enabled: false` on the generator options, alongside `--font-cache-dir`.

This does not change generated files — `generate` performs no Google Fonts fetching in the first place (fetching happens only in the dev-server preview pipeline) — but the flag now reaches the generator configuration as documented, instead of being dropped before it gets there.
