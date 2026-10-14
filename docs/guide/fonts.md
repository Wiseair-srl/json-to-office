# Fonts

By default a generated `.docx` or `.pptx` **references** its fonts by name and relies on the reader's machine to have them. This page covers which fonts are safe to use that way, and the three ways to handle everything else: keep the references (`custom`, the default), rewrite them to safe fonts (`substitute`), or — DOCX only, opt-in — write the font files into the document (`embed`). It also covers strict validation and registering custom typefaces.

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

| Mode               | Behavior                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `custom` (default) | References are kept as authored. Readers with the font installed see the intended typeface; everyone else gets the host's fallback. Emits a single `FONT_MODE_CUSTOM` warning when non-safe fonts are present and a `fonts` option was passed.                                                                                                                                        |
| `substitute`       | Every non-safe family in the document _and_ theme is rewritten to a SAFE_FONTS equivalent at generate time, so output renders identically everywhere. Emits a single `FONT_MODE_SUBSTITUTED` warning listing the swaps.                                                                                                                                                               |
| `embed`            | DOCX on the `docxjs` renderer only, opt-in. References are kept as in `custom`, and the resolved TTF/OTF files of every non-safe family are written into the document, so readers without the font installed still see it. Weights, formats and licences limit what embeds — see [Embedding fonts](#embedding-fonts). Emits a single `FONT_MODE_EMBED` warning listing what embedded. |

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

## Embedding fonts

`embed` is opt-in: `options.fonts.mode: 'embed'` (library), `--font-mode embed` (CLI), `fonts.mode: "embed"` on the MCP server's `jto_generate`, or **Embed fonts in the file** in the playground's export dialog. The dev-server API honours `options.fonts.mode: "embed"` on `POST /api/docx/generate` too: what it embeds comes from the server's own font resolution, never from the request.

```bash
jto docx generate report.json --font-mode embed
```

```ts
const buffer = await generateBufferFromJson(json, {
  fonts: { mode: 'embed' },
});
```

The bytes come from the same resolution as the rest of this page — the theme's and document's `fontRegistry`, `extraEntries`, Google Fonts — so a family has to be [registered](#registering-non-safe-fonts) to embed; an unregistered one stays a reference. Safe fonts never embed.

**Where it works.** DOCX, on the default `docxjs` renderer. The `office-open` renderer does not embed yet: asked to, it keeps the references as in `custom` and says so with `FONT_EMBED_UNSUPPORTED_RENDERER`. PPTX does not embed fonts at all and falls back the same way, with `FONT_EMBED_UNSUPPORTED_FORMAT`.

**Which faces.** Word's font table holds four faces per family — regular, bold, italic, bold italic — and a run chooses among them with nothing but its bold and italic toggles. Each slot takes the family's weight 400 (regular, italic) or 700 (bold, bold italic); when that weight is missing, the nearest one on the same side fills in — 500 for regular, 600 for bold — and the summary names the substitution. Any other weight (100–300, 800, 900, or a 500 beside a 400) is not embedded and gets a `FONT_EMBED_WEIGHT_DROPPED` warning. Its reference stays as authored: a run at that weight names its sub-family (`fontWeight: 300` on Inter writes `Inter Light`, see [`fontWeight` vs `bold`](#fontweight-vs-bold)), which the document does not carry, so a reader without the font sees a fallback there, exactly as in `custom`. A family without a regular face embeds nothing.

::: warning Word for Mac
Word for Mac silently substitutes a face it cannot address by family plus bold/italic — one of the reasons jto once stopped embedding. Keeping to the four slots is what avoids it, which is why other weights are left out rather than embedded. Check the document in Word for Mac before relying on a family whose regular or bold face came from a nearest weight.
:::

**Formats.** Only TrueType and OpenType files embed. A WOFF, WOFF2, EOT or Type 1 source is skipped with `FONT_EMBED_SKIPPED_FORMAT`; nothing is converted. Google Fonts resolve to TTF, so this concerns the files you register yourself.

**Licences.** Each face's `OS/2.fsType` is read before it embeds:

| `fsType` | Licence         | What happens                                                              |
| -------- | --------------- | ------------------------------------------------------------------------- |
| `0x0000` | Installable     | Embedded.                                                                 |
| `0x0008` | Editable        | Embedded.                                                                 |
| `0x0004` | Preview & print | Embedded, with `FONT_EMBED_READ_ONLY`: Word opens the document read-only. |
| `0x0002` | Restricted      | Not embedded: `FONT_EMBED_SKIPPED_LICENSE`.                               |

When a font sets several of these bits, the least restrictive applies, as the OpenType specification says. A face whose OS/2 table cannot be read counts as installable.

**File size.** The whole font file is embedded, not a subset of the glyphs the document uses, so each face adds its full size, which for a large family runs to megabytes.

**Reproducible builds.** OOXML stores an embedded font obfuscated with a key. With `deterministic` on — the default — the key is derived from the font's own bytes, so the same JSON and fonts build the same file; `--no-deterministic` keeps the random keys the renderer generates.

## Strict mode

`options.fonts.strict: true` (library) or `--strict-fonts` (CLI) turns unresolved font references into hard failures instead of warnings: generation **throws** on any family that is neither in SAFE_FONTS nor backed by a registered entry.

The check runs _after_ the export-mode pre-pass, which makes the modes behave differently under strict:

- In `custom` (and `embed`) mode, every non-safe reference survives to validation — strict throws.
- In `substitute` mode, non-safe references have already been rewritten to safe fonts — strict only throws if something slipped past the rewrite (e.g. a custom substitution targeting another non-safe family).

::: warning
Strict is a library/CLI feature only. The dev-server HTTP API strips `strict` from client-supplied `options.fonts` on `POST /api/<format>/generate`, so a stray font reference can't be turned into a predictable 500. See the [CLI reference](/reference/cli) for that endpoint.
:::

## Registering non-safe fonts

To use a font outside SAFE_FONTS, register it. There are three places to do that, and they compose — later ones win on a family (or `id`) collision:

| Where    | How                              | Use it for                                                                       |
| -------- | -------------------------------- | -------------------------------------------------------------------------------- |
| Theme    | `fontRegistry` at the theme root | A brand font every document using that theme should get.                         |
| Document | `props.fontRegistry`             | A font that travels **with the JSON** — survives export, re-import, and sharing. |
| Runtime  | `options.fonts.extraEntries`     | Host-supplied overrides that should not be written into the document.            |

Each registry entry has an `id`, a `family` (the display name you reference from `font.family` / `fontFace` / `theme.fonts.*`), an optional `category` (`sans` | `serif` | `mono` | `display` | `handwriting` — used by the substitution fallback), and one or more `sources`. Six source kinds are supported:

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

The same entry shape goes in the document itself, which is the portable option — nothing outside the JSON is needed:

```json
{
  "name": "docx",
  "props": {
    "fontRegistry": [
      {
        "id": "brand-sans",
        "family": "Brand Sans",
        "category": "sans",
        "sources": [{ "kind": "data", "data": "AAEAAA...", "weight": 400 }]
      }
    ]
  }
}
```

A `fontRegistry` is a **declaration, not a reference**: the families named inside it (including a `google` source's `family`) are not treated as fonts the document uses, and `substitute` mode never rewrites them. Only actual `font.family` / `fontFace` / `theme.fonts.*` references count.

::: warning Registration alone embeds nothing
Registered font bytes are materialized (fetched, cached, pinned) only for the pipelines that need the real font files:

- the **LibreOffice preview**, which registers them with the OS so the in-browser PDF preview shows the real typeface;
- **`visual` rasterization**, where an out-of-process LibreOffice renders the nested slide to a PNG;
- **`highcharts`**, whose export server sets the chart in the document's faces; and
- **`embed` mode**, which writes them into the `.docx`.

The last three have a consequence worth knowing: such a document materializes its fonts — including Google Fonts network fetches — even on a plain CLI `jto docx generate`, with no preview involved. A document with none of them, built in `custom` or `substitute` mode, never fetches.

Outside `embed` mode the downloaded `.docx`/`.pptx` bytes are unaffected either way: registering a font never puts it in the file.
:::

### From the playground

The **Fonts** dialog has a **Custom** tab that writes into the open document's `props.fontRegistry` for you:

- **Upload a font file** — drop in a `.ttf` or `.otf` (2 MB each). It is base64-encoded in the browser and stored as a `kind: "data"` source, so the font travels with the document. WOFF and WOFF2 are rejected: the preview stager registers every face as a `.ttf`, so a web font would silently fail to load. Family and weight are guessed from the filename (`Geist-SemiBold.ttf` → Geist at 600) and you can reference the family straight away.
- **Embed any Google font** — not just the curated catalog. The family is fetched server-side and stored as `kind: "data"` sources too.

Because the bytes live inside the JSON, the whole document is capped at 12 MB before it exceeds the server's request limit; the dialog refuses a write that would cross it.

Uploaded and embedded fonts also render in the **fast in-browser preview**, which synthesizes an `@font-face` block from the registry. Intermediate weights work there too: a run authored as `fontWeight: 300` is written into the DOCX as the sub-family `Brand Sans Light`, and the preview registers a matching face under that exact name.

## CLI font flags

All flags apply to `jto docx generate` and `jto pptx generate`; see the [CLI reference](/reference/cli) for the full command surface.

| Flag                              | Description                                                                                                                                                                                                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--font <name=path>`              | Register a font file (repeatable): `<family>=<path to .ttf/.otf>`.                                                                                                                                                                                                       |
| `--fonts-dir <path>`              | Scan a directory for `.ttf`/`.otf` files and auto-register them by filename.                                                                                                                                                                                             |
| `--font-mode <mode>`              | `custom` (default), `substitute`, or `embed` (DOCX on the `docxjs` renderer; see [Embedding fonts](#embedding-fonts)).                                                                                                                                                   |
| `--font-substitute <family=safe>` | Map a non-safe family to a specific safe font (repeatable; used with `--font-mode substitute`).                                                                                                                                                                          |
| `--strict-fonts`                  | Fail generation on unresolved font references.                                                                                                                                                                                                                           |
| `--no-google-fonts`               | Sets `fonts.googleFonts.enabled: false`. `generate` fetches only when it needs font files — in `embed` mode, or for a document with a `visual` or `highcharts` — so this keeps such a build offline, at the cost of those Google families; otherwise it changes nothing. |
| `--font-cache-dir <path>`         | Sets `fonts.googleFonts.cacheDir`, the disk cache for those same fetches; inert when `generate` fetches nothing.                                                                                                                                                         |

## Warning codes

Font handling surfaces structured warnings you can collect programmatically (via the `warnings` option) or read from CLI output:

| Code                              | Meaning                                                                                                                                                                                                                                                                                                                          |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FONT_UNRESOLVED`                 | A family is neither in SAFE_FONTS nor registered; output relies on host fallback. Becomes a thrown error under strict mode.                                                                                                                                                                                                      |
| `FONT_MODE_SUBSTITUTED`           | Substitute mode rewrote one or more families (the warning lists the swaps).                                                                                                                                                                                                                                                      |
| `FONT_MODE_CUSTOM`                | Custom mode kept non-safe references as authored.                                                                                                                                                                                                                                                                                |
| `FONT_MODE_EMBED`                 | Embed mode's one summary: the families embedded and their faces, the faces filled from a nearest weight, and the non-safe families that embedded nothing.                                                                                                                                                                        |
| `FONT_EMBED_SKIPPED_FORMAT`       | A face is not TTF or OTF (WOFF, WOFF2, EOT, Type 1) and was not embedded.                                                                                                                                                                                                                                                        |
| `FONT_EMBED_SKIPPED_LICENSE`      | A face's `OS/2.fsType` restricts embedding; it was not embedded.                                                                                                                                                                                                                                                                 |
| `FONT_EMBED_READ_ONLY`            | A face was embedded under a preview & print licence; Word opens the document read-only.                                                                                                                                                                                                                                          |
| `FONT_EMBED_WEIGHT_DROPPED`       | A face fills none of Word's four slots per family, or another face already fills its slot; it stays a reference.                                                                                                                                                                                                                 |
| `FONT_EMBED_UNSUPPORTED_RENDERER` | `embed` was asked of a DOCX renderer other than `docxjs`; references kept as in `custom`.                                                                                                                                                                                                                                        |
| `FONT_EMBED_UNSUPPORTED_FORMAT`   | `embed` was asked of a PPTX; references kept as in `custom`.                                                                                                                                                                                                                                                                     |
| `FONT_METADATA_DEFECT:*`          | Non-fatal TTF metadata issues found by the registry validator: `WEIGHT_CLASS_MISMATCH`, `SUBFAMILY_MISMATCH`, `LEGACY_SUBFAMILY_MISMATCH`. `fsType` embedding-permission bits are not checked here, on every resolution; `embed` mode reads them per face when it embeds (`FONT_EMBED_SKIPPED_LICENSE`, `FONT_EMBED_READ_ONLY`). |
| `FONT_OVERRIDE_LOCAL`             | A caller-supplied `extraEntries` entry took precedence over the Google Fonts auto-fetch for a referenced family. Emitted only by the dev-server (playground preview) pipeline — never by CLI `generate` or the library.                                                                                                          |

## `fontWeight` vs `bold`

Anywhere text formatting is accepted (document props, theme fonts, style presets), you can set either:

- `bold: true` — equivalent to `fontWeight: 700`, or
- `fontWeight` — an integer from **100 to 900**, for finer control with families that ship intermediate weights (e.g. 300 Light, 600 SemiBold).

When both are set, `fontWeight` wins. Combine with a `google` or `variable` source entry that declares the weights you use so the preview can render them faithfully.

::: tip
The bundled Google Fonts catalog (`POPULAR_GOOGLE_FONTS`) is a curated snapshot in `@json-to-office/shared`. Maintainers refresh it with `GOOGLE_FONTS_API_KEY=... pnpm --filter @json-to-office/shared update:fonts-catalog`. See [Contributing](/guide/contributing).
:::
