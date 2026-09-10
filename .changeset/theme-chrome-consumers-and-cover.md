---
'@json-to-office/core-docx': major
'@json-to-office/core-pptx': major
'@json-to-office/shared': minor
'@json-to-office/mcp-server': major
'@json-to-office/jto-ops': patch
'@json-to-office/jto': patch
---

Theme chrome recipes and the motif now reach the page in both formats (#361), and the report cover is a masthead (#407).

**Every recipe has a consumer, and the inventory says which.** `docs/reference/theme-schema.md` now carries a table of `chrome` recipe × format × the composition that paints it, with a reason beside each field a format does not draw. `runningHead`, `tracker`, `actionTitle`, `keyTakeaways`, `sourceLine`, `confidentialFooter`, `logoSlot` and `cover` are read by the report and deck blocks; `motif` marks the top edge of the cover in both formats, and `kind: "none"` resolves to no motif at all so a composition can ask for it and draw nothing. `fill` is the one field nothing paints — no shipped block has a filled surface behind text — and that is stated rather than left as a gap.

**A composition names the type role it paints in.** A block paragraph carried `font.family` pinned to `fonts.body.family`, so a theme's `display` role went on saying `face: "heading"` while the cover title rendered in the body face, and `tracker`'s `case: "upper"` and tracking never reached the running head. Paragraphs now name the role and let the style carry face, case, tracking, weight and spacing; the visible effect on the bundled themes is a running head set in tracked capitals, a cover title in the heading face, and section numbers and memo labels in the eyebrow role's own case.

**Recipes layer over roles through a `$theme` pointer chain.** `{ "$theme": ["/chrome/sourceLine/color", "/styles/source/color"], "default": "textMuted" }` reads "the recipe's colour, else the role's, else this" — so a theme that states no chrome renders exactly as before, and one that states some overrides only what it names. `$if`, `$each` and `$count` also accept a `{ "$theme": … }` operand, which is how an optional recipe field draws nothing on a theme that omits it.

**A `themeStyle` naming a style the theme does not define no longer emits `w:pStyle`.** The paragraph used to reference a style that is not in `styles.xml`; Word ignores that, LibreOffice drops the paragraph's direct spacing along with it. The paragraph's own run and spacing props are the documented fallback.

**The report cover is a masthead.** The theme's motif marks the top edge, the client sits under it in the eyebrow role, the cover rule and the title fall a third of the way down, and a `Prepared for / Date / Classification` band is pinned to the foot of the text area under a hairline — so a one-line and a three-line title leave the page equally balanced. A label whose value is missing is omitted with it. Chosen with Paolo from three rendered proposals across the four bundled DOCX themes at short, long and three-line titles.

Breaking: the cover's `date`, `confidentiality` and `client` slots are bounded tighter (3, 4 and 6 words) so the metadata band cannot overflow the page — a document with longer values is now rejected at validation. `vermilion`'s `chrome.cover.color` and `chrome.actionTitle.color` become `accent`, matching the display and heading colours those recipes now paint. Every `blocks/*` corpus golden moved, with the reasons recorded in `docs/architecture/office-renderer-ir.md`.
