# Fonts

json-to-office **never embeds font bytes** into a generated `.docx` or `.pptx` — the output always relies on fonts installed on the reader's machine. This page explains why, which fonts are safe to use, and how the library handles everything else: substitution, strict validation, and registering custom typefaces for preview rendering.

::: info Why no embedding?
Correct font embedding in OOXML is a minefield: Word for Mac silently falls back for non-regular/bold/italic weights, `fsType` license bits can forbid embedding, WOFF/WOFF2 aren't spec-compliant inside OOXML, and Google Fonts metadata routinely needs byte-level patching before Word accepts it. Substitution to office-installed fonts sidesteps every one of those failure modes and keeps output predictable.
:::

## SAFE_FONTS

These 15 families ship with Microsoft Office, Windows, or macOS. Referencing them guarantees the output renders as authored on any machine, with no substitution and no warnings:

```
Arial, Calibri, Cambria, Consolas, Courier New, Georgia,
Segoe UI, Tahoma, Times New Roman, Trebuchet MS, Verdana,
Helvetica, Helvetica Neue, Menlo, Monaco
```

Matching is case-insensitive. Every other family is "non-safe" and goes through the export-mode pre-pass below.

## Export modes

Every referenced font family — collected from the document **and** the active theme — is checked against SAFE_FONTS before rendering. What happens to non-safe references depends on the mode, set via `options.fonts.mode` (library) or `--font-mode` (CLI):

| Mode               | Behavior                                                                                                                                                                                                                                       |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `custom` (default) | References are kept as authored. Readers with the font installed see the intended typeface; everyone else gets the host's fallback. Emits a single `FONT_MODE_CUSTOM` warning when non-safe fonts are present and a `fonts` option was passed. |
| `substitute`       | Every non-safe family in the document _and_ theme is rewritten to a SAFE_FONTS equivalent at generate time, so output renders identically everywhere. Emits a single `FONT_MODE_SUBSTITUTED` warning listing the swaps.                        |

### The default substitution map

In `substitute` mode, each non-safe family is mapped in this order:

1. **Explicit built-in overrides** for popular families — e.g. `Inter` → Calibri, `Playfair Display` → Georgia, `JetBrains Mono` → Consolas.
2. **Category fallback**, using the family's category from the bundled Google Fonts catalog: sans → **Calibri**, serif → **Georgia**, mono → **Consolas**, display → Georgia, handwriting → Segoe UI.
3. **Calibri** as the final default.

### Overriding substitutions

Force specific swaps with `options.fonts.substitution` (library) or repeatable `--font-substitute` flags (CLI). Anything you don't override falls back to the defaults above.

```bash
jto docx generate report.json \
  --font-mode substitute \
  --font-substitute Inter=Calibri \
  --font-substitute "Playfair Display=Georgia"
```

```ts
import { generateBufferFromJson } from '@json-to-office/core-docx';

const buffer = await generateBufferFromJson(json, {
  fonts: {
    mode: 'substitute',
    substitution: {
      Inter: 'Calibri',
      'Playfair Display': 'Georgia',
    },
  },
});
```

## Strict mode

`options.fonts.strict: true` (library) or `--strict-fonts` (CLI) turns unresolved font references into hard failures instead of warnings: generation **throws** on any family that is neither in SAFE_FONTS nor backed by a registered entry.

The check runs _after_ the export-mode pre-pass, which makes the two modes behave differently under strict:

- In `custom` mode, every non-safe reference survives to validation — strict throws.
- In `substitute` mode, non-safe references have already been rewritten to safe fonts — strict only throws if something slipped past the rewrite (e.g. a custom substitution targeting another non-safe family).

::: warning
Strict is a library/CLI feature only. The HTTP render server strips `strict` from client-supplied options so that a stray font reference can't be turned into a predictable 500. See [Render server](/guide/render-server).
:::

## Registering non-safe fonts

To use a font outside SAFE_FONTS, register it via `options.fonts.extraEntries`. Each registry entry has an `id`, a `family` (the display name you reference from `font.family` / `fontFace` / `theme.fonts.*`), an optional `category` (`sans` | `serif` | `mono` | `display` | `handwriting` — used by the substitution fallback), and one or more `sources`. Six source kinds are supported:

| Kind       | Fields                                                                                                                | Meaning                                                                                               |
| ---------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `safe`     | `family`                                                                                                              | An office-installed font; nothing to fetch.                                                           |
| `google`   | `family`, `weights` (default `[400, 700]`), `italics` (default `false`)                                               | Fetched from Google Fonts at generate time.                                                           |
| `file`     | `path` (`.ttf`/`.otf`; relative paths resolve against the JSON document's directory or `baseDir`), `weight`, `italic` | A local font file.                                                                                    |
| `data`     | `data` (base64 or `data:` URL), `weight`, `italic`                                                                    | Font bytes inlined in the entry — keeps the setup self-contained.                                     |
| `url`      | `url` (HTTPS TTF/OTF), `weight`, `italic`                                                                             | A direct CDN URL — useful to bypass metadata defects in Google's redistributed files.                 |
| `variable` | `url` (variable TTF), `weight` (required), `italic`, `axes`                                                           | A variable font; the `wght` axis (plus any `axes`) is pinned via HarfBuzz to emit a clean static TTF. |

```ts
const buffer = await generateBufferFromJson(json, {
  fonts: {
    extraEntries: [
      {
        id: 'inter',
        family: 'Inter',
        category: 'sans',
        sources: [
          { kind: 'google', family: 'Inter', weights: [400, 600, 700] },
        ],
      },
      {
        id: 'brand-serif',
        family: 'Brand Serif',
        category: 'serif',
        sources: [
          { kind: 'file', path: './fonts/BrandSerif-Regular.ttf', weight: 400 },
        ],
      },
    ],
  },
});
```

::: warning Registration is for preview fidelity, not embedding
Registered font bytes are only materialized (fetched, cached, pinned) for the LibreOffice preview pipeline — the renderer registers them with the OS before LibreOffice runs so the in-browser PDF preview shows the real typeface. The downloaded `.docx`/`.pptx` bytes are unaffected: no embedding, ever. This includes the automatic Google Fonts staging — any referenced family that matches the bundled popular-Google catalog is auto-fetched for preview only.
:::

## CLI font flags

All flags apply to `jto docx generate` and `jto pptx generate`; see the [CLI reference](/reference/cli) for the full command surface.

| Flag                              | Description                                                                                                                                    |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `--font <name=path>`              | Register a font file (repeatable): `<family>=<path to .ttf/.otf>`.                                                                             |
| `--fonts-dir <path>`              | Scan a directory for `.ttf`/`.otf` files and auto-register them by filename.                                                                   |
| `--font-mode <mode>`              | `custom` (default) or `substitute`.                                                                                                            |
| `--font-substitute <family=safe>` | Map a non-safe family to a specific safe font (repeatable; used with `--font-mode substitute`).                                                |
| `--strict-fonts`                  | Fail generation on unresolved font references.                                                                                                 |
| `--no-google-fonts`               | Accepted but currently has no effect: `generate` performs no Google Fonts fetching (fetching happens only in the dev-server preview pipeline). |
| `--font-cache-dir <path>`         | Directory to cache fetched Google Fonts TTFs — currently no effect on `generate` output (preview pipeline only).                               |

## Warning codes

Font handling surfaces structured warnings you can collect programmatically (via the `warnings` option) or read from CLI output:

| Code                     | Meaning                                                                                                                                                                                                                                                                           |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FONT_UNRESOLVED`        | A family is neither in SAFE_FONTS nor registered; output relies on host fallback. Becomes a thrown error under strict mode.                                                                                                                                                       |
| `FONT_MODE_SUBSTITUTED`  | Substitute mode rewrote one or more families (the warning lists the swaps).                                                                                                                                                                                                       |
| `FONT_MODE_CUSTOM`       | Custom mode kept non-safe references as authored.                                                                                                                                                                                                                                 |
| `FONT_METADATA_DEFECT:*` | Non-fatal TTF metadata issues found by the registry validator: `WEIGHT_CLASS_MISMATCH`, `SUBFAMILY_MISMATCH`, `LEGACY_SUBFAMILY_MISMATCH`. `fsType` embedding-permission bits are intentionally _not_ checked — output never embeds fonts, so permission warnings would be noise. |
| `FONT_OVERRIDE_LOCAL`    | A caller-supplied `extraEntries` entry took precedence over the Google Fonts auto-fetch for a referenced family. Emitted only by the dev-server (playground preview) pipeline — never by CLI `generate` or the library.                                                           |

## `fontWeight` vs `bold`

Anywhere text formatting is accepted (document props, theme fonts, style presets), you can set either:

- `bold: true` — equivalent to `fontWeight: 700`, or
- `fontWeight` — an integer from **100 to 900**, for finer control with families that ship intermediate weights (e.g. 300 Light, 600 SemiBold).

When both are set, `fontWeight` wins. Combine with a `google` or `variable` source entry that declares the weights you use so the preview can render them faithfully.

::: tip
The bundled Google Fonts catalog (`POPULAR_GOOGLE_FONTS`) is a curated snapshot in `@json-to-office/shared`. Maintainers refresh it with `GOOGLE_FONTS_API_KEY=... pnpm --filter @json-to-office/shared update:fonts-catalog`. See [Contributing](/guide/contributing).
:::
