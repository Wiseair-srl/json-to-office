# Design direction brief

Before writing any JSON for a new theme or a deck without an existing theme, commit to a visual direction in one short brief. Skipping this step is the single biggest cause of "looks AI-generated" output: the model defaults to safe, generic Office aesthetics (Calibri + navy + grey + centered KPIs) and the user has to push it out of that mode by hand.

## When to skip

- The user provided an explicit theme file → use it as-is.
- The user provided a brand kit, palette, or font requirements → apply them directly.
- A brand or design-system skill is active in the session → defer to it; it injects the theme.
- The user is iterating on an existing themed document → preserve the theme.

## When to do this

Any time you are about to create a new theme, or generate a document whose theme is unspecified, or the user explicitly asks for "designed", "polished", or "professional" output.

## The brief

Write exactly this shape. Show it to the user before generating the theme. Wait for confirmation or adjustment.

```
DIRECTION:        <one-line aesthetic name — editorial / swiss / brutalist / etc.>
PALETTE:          primary=#hex, accent=#hex, background=#hex (+ secondary if needed)
TYPE:             heading=<font family>, body=<font family>
LAYOUT PRINCIPLE: <one line — the dominant compositional move>
MEMORABLE THING:  <one line — the single visual element someone remembers>
ANTI-PATTERNS:    <2-3 things to actively avoid for this direction>
```

Example:

```
DIRECTION:        Editorial industrial — dense, technical, confident
PALETTE:          primary=#1A1A1A, accent=#FF5722, background=#FAFAFA, secondary=#737373
TYPE:             heading=Roboto Slab, body=IBM Plex Sans
LAYOUT PRINCIPLE: Asymmetric grid, oversized numerals as decoration, generous left margin
MEMORABLE THING:  A single ghost numeral (200pt, 12% opacity) anchors each section divider
ANTI-PATTERNS:    No centered titles, no rounded shapes, no soft shadows
```

## Why this works

- The brief forces a commitment. Without it, the model picks "safe" choices at every node and the document drifts toward generic.
- Showing it to the user before authoring catches misalignment cheaply. Re-doing one brief is faster than re-doing a 12-slide deck.
- The brief is **binding for the entire document**. If during authoring you're tempted to reach for a choice that contradicts it (a softer color, a centered title, a rounded card), stop and reconsider. Drift toward "safer" choices mid-document is exactly the failure mode this step prevents.

## Brand-neutrality note

This skill does not curate a fixed library of directions. If a brand or design-system skill is active, **defer to it** for palette/type/anti-patterns and use the brief only to capture LAYOUT PRINCIPLE and MEMORABLE THING. The brand skill owns the visual identity; this skill orchestrates the document structure.
