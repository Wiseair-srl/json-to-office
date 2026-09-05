---
'@json-to-office/core-pptx': patch
---

Fixes four defects in the eval harness and tightens the pptx theme-lookup test, all found by review on #357.

`buildFingerprint` recorded only each package's `dist/index.js`, but `tsup` builds `cli` and `index` as separate entries and a run executes `mcp-server/dist/cli.js`. A CLI-only rebuild therefore left the fingerprint unchanged — invisible to the one check whose entire job is noticing that the compiled product moved under a measurement. It now covers every top-level `dist/*.js`.

The rejudge CLI read an option's value as its positional argument: `--scorecard out/sc.json runs/foo` resolved a runs directory of `out/sc.json`, joined `runs` onto it and wrote `rejudge.json` inside it — a documented invocation producing nothing, or ENOTDIR when the value is a file.

Its two counts disagreed with each other about the same document. A run whose stored judgement carried no `wouldShip` satisfied both predicates, because `undefined !== true` is a change, and printed "1 document(s) re-judged, unchanged since; 1 changed their wouldShip answer". Both counts now require an original verdict, exactly as the `pairs()` helper already did.

`summarise` built an agreement report for `level` and `genericness` even when no stored verdict carried them. `bootstrapKappa([])` answers `n: 0, rawAgreement: 0, kappa: NaN`, which serialises to `null` and prints as "NaN" — a missing measurement wearing the shape of a measurement. Those fields are now omitted, and the CLI says so.

The new pptx bundled-theme test asserted only that `getPptxTheme(name)` returns something schema-valid, which a lookup returning the default theme for every name would satisfy. It now asserts identity against the registry.
