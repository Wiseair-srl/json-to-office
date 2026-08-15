---
'@json-to-office/jto-cli': minor
---

fix(cli): make `--theme` / `--theme-path` and the config file's theme keys actually select the theme

Theme selection was wired up in only half the code paths. Without plugins, `createGenerator`/`generateBuffer` passed `customThemes` and nothing else, so `--theme` was ignored outright and `--theme-path` only worked if the document's `props.theme` happened to name the loaded theme. With plugins, an unknown `--theme` quietly resolved to a built-in default. And in `PluginConfigService.mergeWithOptions`, every CLI option was spread over the config file including the absent ones, so an unset flag overwrote the matching config-file key with `undefined`.

- A requested theme now applies on **both** paths. It is registered under a reserved `customThemes` key (`jto-cli-theme`) and the document's `props.theme` is rewritten to point at it. With no theme requested, the document is passed through untouched and `props.theme` stays in charge — on the plugin path too, where the generator is now constructed with no `theme` at all rather than a `minimal` default that would have restyled every document.
- `--theme` also resolves against the supplied `customThemes` map before trying built-in names and file paths.
- A theme that resolves to nothing — an unknown built-in name, an unreadable file — prints `Unknown theme "X"; keeping the document's own theme` and leaves the document's theme alone. PPTX no longer routes unknown names through `getPptxTheme()`, which answered every one of them with the default theme.
- The theme is resolved **once per generator**, and `--theme-path` is read exactly once inside that resolution. Without plugins the read moved off the per-document path, so a batch of documents produces one `Failed to load theme from …` warning instead of one per document. With plugins it used to be read twice at `createGenerator()` time — once for the requested theme, once for the `customThemes` registry — and printed that warning twice for a single bad path; one read now feeds both.
- Absent CLI flags no longer erase config-file values. `theme`, `themePath`, `validation.allowUnknownFields`, `discovery`, and `aliases` from the config file now take effect when the matching flag is not passed.

**Behaviour changes to expect when upgrading:**

- **A document's own `props.theme` no longer wins over a requested theme.** If you pass `--theme`/`--theme-path`, or your config file sets `theme`/`themePath`, documents that named their own theme now render with the requested one. Drop the flag and the config keys to go back to per-document themes.
- **Config-file `theme` / `themePath` now apply to `generate`.** They were previously wiped by the unset flags and had no effect; a config file left over from that period will start changing output.
- **`theme` and `themePath` merge as one group, not key by key.** Passing either flag supersedes _both_ config-file keys; with neither flag, the config file keeps both and its own `themePath`-before-`theme` order. Previously a config-file `themePath` outranked an explicit `--theme`, which is the case this changes.
- **A mistyped `--theme` no longer silently swaps in a default theme.** It warns and keeps the document's theme, so a typo now shows up as a warning plus unchanged styling instead of a differently styled file.
- **The `Theme:` summary line reports the theme that rendered** instead of echoing the `--theme` flag. It previously printed the `--theme` value or, whenever that flag was absent, the literal `default`. Now: `--theme-path` prints the file path (it printed `default`), config-file `theme`/`themePath` print what they resolved to (they printed `default`, since the unset flags wiped them), an unrecognised `--theme` prints the document's own theme or `default` (it printed the misspelling), `--theme` and `--theme-path` together print the path that won (it printed the `--theme` name), and a document-level `props.theme` is named rather than reported as `default`. A resolved plain `--theme` still prints that name. Scripts scraping the line need updating.
- **A bad `--theme-path` warns once on plugin-loaded runs, not twice.** Anything counting CLI diagnostics sees one fewer.
