# Slide composition taste

Distilled from open-codesign's `slide-deck` design skill. Read before authoring any PPTX template or new deck.

## Frame & safe area

- Aspect: **16:9** (10" × 5.625"). The json-to-office PPTX default already matches.
- Safe area: **0.55" / 56-72px inset from each edge**. Nothing touches the edge except backgrounds.
- Grid: 12 columns × 6 rows by default — declared at deck level via `props.grid`. Use the grid; don't hand-place x/y coords.

## Four archetypal layouts

Almost every slide fits one of these. If yours doesn't, you probably have two slides.

### 1. Title slide

- Big serif headline (60–72pt), light weight, tight letter-spacing (-2), line-height 1.02
- Subtitle (20–24pt) in muted color, max-measure ~640px
- Optional presenter row at bottom: small accent dot + name (sans 14pt, weight 600) + role (sans 12pt muted)
- Eyebrow at top: "KEYNOTE" / event name in accent

### 2. Section divider

- Big chapter number (140pt, mono, accent color, tabular-nums)
- Eyebrow label ("CHAPTER 01") in muted, 12pt uppercase tracked
- Title (56pt serif **italic**, weight 400, letter-spacing -1)
- Use these to break a 5–8 slide arc into 2–3 acts

### 3. Two-column body

- Grid: `1.1fr 1fr` (left side slightly wider — text gets the breathing room, visual gets the visual weight)
- Left: H2 (44pt serif, line-height 1.1) + bulleted list. Bullets numbered with mono accent (01, 02, 03)
- Right: visual placeholder — chart, diagram, screenshot. 4:3 aspect, 12px radius, 1px rule border, subtle gradient fill if empty
- Max **3 bullets** per slide. If you have 5, that's two slides.

### 4. Big-stat

- One huge sans number (180–200pt, weight 700, tabular-nums, letter-spacing -6)
- Inline unit (36pt sans, accent, weight 500) — "%", "×", "M", etc.
- Caption (24pt serif italic, max-measure 620px) below
- Tiny source line at bottom in muted uppercase: "SOURCE: …"

## Page strip (consistent across all slides)

Bottom row, inside safe area:

- Left: `01 / 12` in mono, tabular-nums, 11pt, muted
- Center: thin 1px rule line in `rule` token
- Right: meta string ("Q2 · 2026" / company name) in sans uppercase 11pt 0.12em

## Rules

- **One idea per slide.** If you can't reduce the headline to 6–12 words, split.
- **Title + body, not just body.** Every slide has a 1-line eyebrow OR a H2. Bald body slides feel orphaned.
- **Visual breathing room.** ≥56pt between major elements. Tight slides feel anxious.
- **Use the grid.** Span 8 of 12 columns for a chart, 4 for a sidebar. Don't pixel-place.
- **Background = `bg` token.** Don't hardcode `#fff` or `#000` — themes need to swap.

## Anti-patterns

- Walls of body text (>40 words) on a slide.
- Three-column dense layouts. Slides aren't pages.
- Headlines that wrap awkwardly because they're too long.
- Charts butted right against text with no margin.
- Inconsistent type sizes slide-to-slide — same level = same size everywhere.
- Page numbers in the corner with no rule line — feels like an afterthought.
- Title slides centered when the rest of the deck is left-aligned.
