# Fonts

`json-to-office` does **not** embed fonts into the generated `.docx` / `.pptx`. The rendered document always relies on the fonts installed on the recipient's machine. To produce predictable output across machines, use one of the SAFE_FONTS entries below or rely on substitution mode (default).

## TL;DR

- **Default export mode:** `custom` — font references stay as authored. Recipients with the font installed see the authored typeface; others get a host fallback. The LibreOffice PDF preview uses font staging to render the real typeface during authoring.
- **Substitute mode:** `--font-mode substitute` — rewrite every non-safe family to a SAFE_FONTS equivalent at generate time so output renders identically on every machine.
- **Playground download** prompts for the mode when non-safe fonts are present.

## SAFE_FONTS

These ship with Microsoft Office / macOS / Windows. Using them in a doc or theme guarantees the output renders as authored without substitution.

```
Arial, Calibri, Cambria, Candara, Consolas, Constantia, Corbel,
Courier New, Garamond, Georgia, Helvetica, Palatino, Tahoma,
Times New Roman, Trebuchet MS, Verdana
```

Anything else is "non-safe". Non-safe references pass through `applyExportMode` before render.

## Export modes

Pass via `options.fonts.mode` (library) or `--font-mode <mode>` (CLI).

| Mode               | Behaviour                                                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `custom` (default) | Keep references as-is. Emits one `FONT_MODE_CUSTOM` warning. Recipient must have the font installed or Word falls back.          |
| `substitute`       | Rewrite every non-safe family in doc + theme to a SAFE_FONTS entry. Emits one `FONT_MODE_SUBSTITUTED` warning listing the swaps. |

### Strict validation (`fonts.strict`)

`options.fonts.strict: true` makes `resolveDocumentFonts` throw on any reference that validation reports as unresolved (non-safe and not backed by an `extraEntries` / Google entry). The guard runs **after** `applyExportMode`, so:

- In `custom` mode every non-safe reference survives to validation — strict throws.
- In `substitute` mode every non-safe reference is rewritten to a SAFE_FONTS entry before validation — strict only throws if a reference somehow slipped through the rewrite (custom substitution map targeting another non-safe family, an unknown category, etc.).

Strict is library-only. The HTTP `/generate` route strips it from client-supplied options to avoid turning font references into predictable 500s.

### Overriding the substitution map

Pass `options.fonts.substitution` (library) or `--font-substitute <family=safe>` (CLI, repeatable) to force specific swaps. Anything omitted falls back to `buildDefaultSubstitutionMap`'s category-based defaults (sans → Calibri, serif → Georgia, mono → Consolas).

CLI example:

```
jto docx generate doc.json \
  --font-mode substitute \
  --font-substitute Inter=Calibri \
  --font-substitute "Playfair Display=Georgia"
```

Library example:

```ts
await DocumentGenerator.generateBufferFromJson(json, {
  fonts: {
    mode: 'substitute',
    substitution: {
      Inter: 'Calibri',
      'Playfair Display': 'Georgia',
    },
  },
});
```

## Preview font staging (playground only)

The playground's LibreOffice PDF preview registers resolved fonts with the OS's fontconfig / macOS registration APIs before LibreOffice runs. This lets the preview render non-safe fonts for in-browser review even though the downloaded file itself does not embed them.

Font registration for this path comes from:

- **Google Fonts catalog** (`POPULAR_GOOGLE_FONTS`) — any family referenced in the doc that matches a popular Google family is auto-registered (HTTP-fetched, disk-cached).
- **`options.fonts.extraEntries`** (library) / `--font <name=path>` / `--fonts-dir` (CLI) — user-supplied TTF/OTF.

Nothing here affects the final `.docx` / `.pptx` bytes — it is only for preview fidelity.

## Warning codes

- `FONT_UNRESOLVED` — family not in SAFE_FONTS and not registered as a runtime entry. The output relies on host fallback.
- `FONT_MODE_SUBSTITUTED` — substitute mode rewrote one or more families.
- `FONT_MODE_CUSTOM` — custom mode was selected; no rewrite.
- `FONT_METADATA_DEFECT:*` — TTF metadata issues surfaced by the registry validator (non-fatal). Covers `WEIGHT_CLASS_MISMATCH`, `SUBFAMILY_MISMATCH`, `LEGACY_SUBFAMILY_MISMATCH`. `fsType` embedding-permission bits are intentionally NOT checked — Office output never embeds font bytes, so permission warnings would be pure noise.
- `FONT_OVERRIDE_LOCAL` — a caller-supplied `extraEntries` entry took precedence over the Google Fonts auto-fetch for a family the doc references.

## FAQ

**Why no embedding?** Correct font embedding in OOXML is a minefield — Word for Mac silently falls back for non-RIBBI weights, fsType can forbid embedding, WOFF/WOFF2 aren't spec-compliant inside OOXML, and Google Fonts' metadata routinely needs byte-level patching before Word accepts it. Substitution sidesteps every one of those failure modes.

**How do I keep custom branding?** Either use a SAFE_FONTS entry that matches your brand's visual tone, or accept that recipients without your custom font will see a substitute (use `custom` mode and document the requirement).

**Does the LibreOffice preview show the final look?** For substitute mode, yes — the downloaded file also renders with safe fonts. For custom mode the preview uses the registered custom font while the downloaded file will use whatever the recipient has installed.

## Maintenance

The `POPULAR_GOOGLE_FONTS` catalog in `packages/shared/src/fonts/catalog/popular-google.ts` is a curated snapshot. To refresh its `weights` / `hasItalic` / `category` fields from the upstream Google Fonts API:

```
GOOGLE_FONTS_API_KEY=... pnpm --filter @json-to-office/shared update:fonts-catalog
```

The family allowlist is read directly from the current file — to add or remove a family, edit `popular-google.ts` and re-run. The script reports any allowlisted families missing from the API response (deprecated upstream) so you can decide whether to drop them.
