# Fonts

json-to-office turns font names referenced in your JSON into real embedded typefaces in the generated `.docx` / `.pptx`.

**Themes name fonts. Code registers them.** A theme file says `"heading": "Inter"`, and at generate time you pass the source for Inter via `options.fonts.extraEntries`. Keeping sources out of the JSON means themes stay portable (no filesystem paths leaking in, no megabytes of base64), and font loading is an explicit, reviewable runtime concern.

## TL;DR

| Need                               | Do                                                                                                                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Any Office computer will open this | Use a name from [SAFE_FONTS](#safe-fonts) in `theme.fonts`. Done.                                                                                                         |
| A specific Google Font             | Set `theme.fonts.heading = "Inter"`, then pass `fonts.extraEntries: [{ id: 'Inter', family: 'Inter', sources: [{ kind: 'google', family: 'Inter' }] }]` to the generator. |
| A licensed / custom TTF            | `sources: [{ kind: 'file', path: './fonts/Brand.ttf' }]` in `extraEntries`.                                                                                               |
| Self-contained single-blob         | `sources: [{ kind: 'data', data: <base64> }]` in `extraEntries`.                                                                                                          |

Referenced font names that are neither in SAFE_FONTS nor in `extraEntries` still render — but the viewer's machine substitutes the font. Tooling emits a `FONT_UNRESOLVED` warning.

## Safe fonts

Pre-installed with Microsoft Office on Windows + macOS. No registration needed — just use them in `theme.fonts`.

```
Arial · Calibri · Cambria · Consolas · Courier New · Georgia · Segoe UI
Tahoma · Times New Roman · Trebuchet MS · Verdana · Helvetica
Helvetica Neue · Menlo · Monaco
```

## Code-side registration

Pass `fonts.extraEntries` to any generator entry point:

```ts
import { generateBufferFromJson } from '@json-to-office/json-to-docx';

const buffer = await generateBufferFromJson(doc, {
  fonts: {
    extraEntries: [
      {
        id: 'Inter',
        family: 'Inter',
        category: 'sans',
        fallback: 'Arial',
        sources: [{ kind: 'google', family: 'Inter', weights: [400, 700] }],
      },
      {
        id: 'Brand',
        family: 'BrandPro',
        sources: [
          { kind: 'file', path: './fonts/BrandPro-Regular.ttf', weight: 400 },
          { kind: 'file', path: './fonts/BrandPro-Bold.ttf', weight: 700 },
        ],
      },
    ],
    googleFonts: {
      enabled: true,
      cacheDir: '.jto-font-cache',
    },
    baseDir: __dirname, // used to resolve relative `kind: "file"` paths
    strict: false,
  },
});
```

### Source kinds

| Kind       | Required                       | Optional                                    | When                                                           |
| ---------- | ------------------------------ | ------------------------------------------- | -------------------------------------------------------------- |
| `"safe"`   | `family`                       | —                                           | Alias an Office-installed font (no embedding).                 |
| `"google"` | `family`                       | `weights` (default `[400, 700]`), `italics` | Google Fonts — auto-fetched + embedded.                        |
| `"file"`   | `path`                         | `weight`, `italic`                          | Local TTF/OTF. Relative paths resolve against `baseDir`.       |
| `"data"`   | `data` (base64 or `data:` URL) | `weight`, `italic`                          | Fully inline source; survives transfer without external files. |

Each entry in `extraEntries` can mix multiple sources (e.g. regular + bold + italic). The registry indexes by `family` and `id` (case-insensitive).

## Per-format notes

### DOCX

Uses the [`docx`](https://www.npmjs.com/package/docx) library's native `FontOptions[]`. Embedded fonts travel in the `.docx` zip under `word/fonts/`; Word 2007+ renders them automatically.

### PPTX

`pptxgenjs` has no public font-embedding API. We post-process the generated `.pptx` with [`pptx-embed-fonts`](https://www.npmjs.com/package/pptx-embed-fonts) to inject the font parts. Transparent — just works if you register via `extraEntries`.

## Google Fonts

`kind: "google"` triggers an HTTP fetch at generate time:

1. Request CSS from `fonts.googleapis.com/css2` with an older User-Agent (so Google returns TTF URLs, not WOFF2).
2. Parse `@font-face` blocks.
3. Download each TTF.
4. Embed into the output.

Memory + optional disk cache (`cacheDir`). Disable with `googleFonts.enabled: false` for offline builds.

## Strict mode

```ts
await generateBufferFromJson(doc, { fonts: { strict: true } });
```

Promotes `FONT_UNRESOLVED` warnings to thrown errors. Useful in CI.

## CLI flags

```
--font <name>=<path>     Register one TTF/OTF (repeatable)
--fonts-dir <path>       Scan dir for .ttf/.otf, coalesce variants by family
--strict-fonts           Fail on unresolved font references
--no-google-fonts        Disable Google Fonts HTTP fetch (offline builds)
--font-cache-dir <path>  Disk cache for Google TTFs (default: .jto-font-cache)
```

Filenames like `Inter-Bold.ttf`, `Roboto_500.otf`, `Brand Italic.ttf` are parsed for weight/italic. Sibling files for the same family coalesce into one entry with multiple sources.

## CLI: `jto <format> fonts`

Font introspection and Google Fonts install helper. Runs under both `jto docx` and `jto pptx`.

```
jto docx fonts list [document] [--fonts-dir ./fonts]
jto docx fonts inspect <file.ttf>
jto docx fonts install <family> [--weights 400,700] [--italics] [--dir ./fonts]
```

- **`list`** — prints SAFE_FONTS, every font in `./fonts` (or `--fonts-dir <dir>`), and (if a doc is given) every font referenced by that JSON, marking each as `[safe]`, `[google]`, or `[unresolved]`.
- **`inspect <file>`** — prints family/weight/italic/format/size for a TTF or OTF. Warns when the file isn't a TTF/OTF (WOFF can't embed in `.docx`).
- **`install <family>`** — downloads a Google Fonts family into `./fonts/` with filenames (`Family-Weight[Italic].ttf`) that `--fonts-dir` auto-picks up. Enables hermetic builds: commit the font into your repo, CI doesn't need Google Fonts network access.

## LLM prompt snippet

When asking an LLM to generate a json-to-office theme or document, include:

> **Fonts**: Use `theme.fonts.heading` / `theme.fonts.body` to name typefaces. Prefer SAFE_FONTS (Arial, Calibri, Cambria, Consolas, Courier New, Georgia, Segoe UI, Tahoma, Times New Roman, Trebuchet MS, Verdana, Helvetica, Helvetica Neue, Menlo, Monaco). For any other font, the user's generator call must include `options.fonts.extraEntries` with matching `kind: "google" | "file" | "data"` sources. Never write file paths or base64 into the JSON.

## Playground

The playground's preview header has a "Browse fonts" action. It opens a picker with:

- **Safe** — 15 Office-safe fonts. "Set heading"/"Set body" writes the name to `theme.fonts.*`.
- **Google** — popular Google Fonts with live previews. Picking one writes the name to `theme.fonts.*`.

When the playground generates a preview, it auto-registers any referenced POPULAR_GOOGLE_FONTS family behind the scenes so embedding just works during development. **Production builds still need to pass `fonts.extraEntries`** — this convenience is dev-only.

The picker is disabled unless the active tab is a `.theme.json` file.

## Troubleshooting

**"Font X is not registered" warning, but the document looks fine in preview.** The preview uses system fonts; the generated file will fall back on viewers that don't have the font installed. Register it via `fonts.extraEntries`.

**Embedded font renders as Arial / Times.** The TTF/OTF is likely malformed or the declared `family` doesn't match the font's internal name. Run with `--strict-fonts` to surface embed failures as errors.

**Google Fonts fetch times out.** Pre-populate a `cacheDir` from a machine with access, then copy it to the build environment. Or use `kind: "file"` with a locally-checked-in TTF.

**PPTX font works in PowerPoint but not in Keynote / Google Slides.** Those viewers don't honor embedded PowerPoint fonts. The font must also be installed on the viewer's machine.
