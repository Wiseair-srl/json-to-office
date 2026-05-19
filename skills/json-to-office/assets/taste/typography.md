# Typography taste

Distilled from open-codesign's `editorial-typography` and `slide-deck` design skills. Use these rules whenever authoring DOCX or PPTX JSON. Override only when a brand/design-system skill is active and provides its own scale.

## Three-typeface system

Use a serif/sans/mono triad. Never mix more than three families per document.

- **Serif (headlines, pull quotes, body in long-form essays)** — Fraunces, DM Serif Display, Georgia (fallback)
- **Sans (UI labels, body in reports/decks, captions, eyebrows)** — DM Sans, Inter, system-ui (fallback)
- **Mono (numerics, code, page numbers, technical labels)** — JetBrains Mono, ui-monospace (fallback)

Numbers always render in sans or mono with **tabular figures** (`'tnum'` OpenType feature). Never italic serif on numbers — it looks broken in tables and slide stats.

## Scale (display ratio ~1.25, body ratio ~1.125)

For PPTX (16:9, slide-level type sizes in pt):

| Use                 | Size (pt) | Family         | Weight | Letter-spacing |
| ------------------- | --------: | -------------- | -----: | -------------: |
| Title slide H1      |     60–72 | Serif          |    400 |             -2 |
| Section divider H2  |     40–52 | Serif italic   |    400 |             -1 |
| Body slide H2       |     32–40 | Serif          |    400 |             -1 |
| Stat number         |   140–200 | Sans           |    700 |             -6 |
| Body / bullet       |     14–18 | Sans           |    400 |         normal |
| Eyebrow / kicker    |      9–11 | Sans uppercase |    500 |   +0.18–0.22em |
| Page strip / footer |      9–11 | Mono           |    400 |         normal |

For DOCX (page-level type sizes in pt):

| Use                       | Size (pt) | Family                         | Weight |
| ------------------------- | --------: | ------------------------------ | -----: |
| H1 (cover, article title) |     48–64 | Serif                          |    400 |
| H2 (section)              |     24–32 | Serif                          |    400 |
| H3 (subsection)           |     16–20 | Sans                           |    600 |
| Body                      |     11–13 | Serif (essay) or Sans (report) |    400 |
| Caption / footnote        |      9–10 | Sans                           |    400 |
| Eyebrow                   |      9–10 | Sans uppercase tracked         |    500 |

## Line-height & measure

- Body line-height: **1.5–1.7** (longer for serif essays, shorter for sans reports).
- Headline line-height: **1.02–1.10**. Big type needs tight leading.
- Measure (line length): aim for **45–75 characters**. Hard cap a body column at 720px / 6.5 inches.

## Hierarchy via size, not weight

- Avoid bolding body. Differentiate H2 from body via size + family change, not via `**bold**` everywhere.
- Italic = tone shift (pull quote, subtitle, parenthetical), not emphasis on a word.

## Eyebrows / kickers

Any non-title section should have a short uppercase eyebrow in accent color:

```
THE ARGUMENT
Long-form headline below.
```

11px, +0.18em letter-spacing, accent token, sometimes with a leading 24×1px rule.

## Diacritics & elision apostrophes

Non-English content keeps its diacritics. Italian: `à è é ì ò ù` and elision apostrophes (`L'`, `dell'`, `un'`). French: `à â ç é è ê ë î ï ô û ù ü ÿ` plus apostrophes. Spanish: `á é í ó ú ñ ü` plus the inverted `¿ ¡`. German: `ä ö ü ß`. Portuguese: `ã õ ç á é í ó ú à â ê ô`.

ASCII-safe substitutions ("Perche" for "Perché", "mobilita" for "mobilità", "L ottimizzazione" for "L'ottimizzazione") are obvious to a native reader and make the deck look machine-generated. The renderer handles Unicode fine — don't strip.

Italian all-caps eyebrows traditionally drop diacritics (`PERCHE`, not `PERCHÉ`) — that's a style choice, not a typo. Apply diacritics to mixed-case body and headings; drop them only in tracked uppercase labels.

## Anti-patterns

- More than three typefaces in one document.
- Italic numbers (e.g. _42%_ in a serif italic stat — breaks tabular alignment).
- Body weight 600+ everywhere ("bold for emphasis everywhere = no emphasis").
- Headlines at body line-height (1.5 on a 60pt headline looks limp).
- Measure > 90 characters — eye loses the line.
- Hex colors hardcoded into text props instead of theme tokens.
- Missing diacritics or elision apostrophes in non-English mixed-case text.
