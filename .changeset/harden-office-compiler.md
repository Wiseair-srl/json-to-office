---
'@json-to-office/core-docx': minor
'@json-to-office/core-pptx': minor
'@json-to-office/json-to-docx': minor
'@json-to-office/json-to-pptx': minor
'@json-to-office/jto-cli': minor
'@json-to-office/jto': minor
'@json-to-office/shared-docx': minor
'@json-to-office/shared-pptx': minor
'@json-to-office/shared': minor
---

Make generation strict and deterministic by default, harden HTTP rendering,
ship real schema exports, and migrate CLI output to Ink.

Behaviour changes to expect when upgrading:

- **The root component now requires a `props` key.** This aligns the runtime
  validator with the exported JSON Schema, which already marked `props` as
  required. Every field inside it stays optional, so documents that omitted it
  only need `"props": {}`.
- **Custom component subtrees are now validated.** Standard components authored
  inside a plugin container must satisfy the same prop and tree contract they
  do elsewhere; previously the whole subtree was skipped.
- **CLI errors go to stderr, and non-TTY output is plain.** Piped or redirected
  output no longer carries terminal escape sequences and is no longer wrapped
  to the terminal width. Use `-f json` for machine-readable results.
- **Render server:** `resources.files` is rejected in safe mode (Highcharts
  loads it as JavaScript), export dimensions declared under `infile.exporting`
  are now capped, and any `NODE_ENV` other than `development` / `test` gets
  production-grade auth, rate-limit, and outbound-source defaults.
