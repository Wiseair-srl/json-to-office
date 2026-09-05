# Phase 1 implementation map — the extended theme schema (#328–#333)

Produced by a fan-out of eight readers over the theme system in both formats, then put through two
adversarial critics. It is a map, not a decision: where the readers and the critics disagree, both
readings are kept. Recorded here because it cost four million tokens to produce and it was living in
a scratch directory.

Read it with `docs/architecture/design-quality-10x.md` §5B open — that is the spec this plans.

## Verdict

> **Status, 2026-09-05.** Tasks 1 and 2 are done, shipped in #355 (`ef65176` plus the pptx
> bundled-theme guard). The decisions section at the bottom is settled. Phase 1 starts at task 3,
> and task 8 has been split out as #328b — see decision 5.

Phase 1 as specced is buildable, and #328 is mostly additive — but only if the first commit fixes
`ensureThemeDefaults`, which is a whitelist rebuild (packages/core-
docx/src/themes/defaults.ts:138-164), not a merge: it already silently deletes the schema-legal
`fontRegistry` and `noProofWords` from every bundled and `--theme-path` theme, and would delete
every new layer the same way — validation passes, generation succeeds, the design is just absent.
The single hardest part is the type-role ladder, because the two formats share zero style field
names (docx `size/color/alignment/spacing` vs pptx `fontSize/fontColor/align/paraSpaceAfter`) and
their extension points are opposite — docx `styles` is an open map (packages/shared-
docx/src/schemas/theme.ts:339) while pptx `styles` is a closed 7-slot union whose names double as an
authorable component prop (packages/shared/src/schemas/slide-content/theme.ts:45-58) — so "paired
variants share tokens" cannot be satisfied by adding roles to either format's presets; it needs one
neutral role vocabulary that each compiler projects onto its own shape. Everything else (palette
roles, spacing, chrome, motifs, component defaults) is optional-and-additive and can land without
moving a single golden.

## Where the schema goes

SHARED — new file `packages/shared/src/theme/design-system.ts`, next to the existing `chart-
palette.ts` (the only cross-format theme home today). Shared because these are the values that must
be IDENTICAL for a paired deck and report to match. ``ts export const TYPE_ROLES =
['eyebrow','display','stat','quote','label','footer',
'tableHeader','tableCell','chartLabel','tracker','source'] as const; export const CANVASES =
['a4','letter','wide169','standard43'] as const;  export const TextCaseSchema = Type.Union([
Type.Literal('none'), Type.Literal('upper'), Type.Literal('smallCaps')]);  /** Palette ROLES. A
sibling of `colors`, NOT inside it. */ export const PaletteSchema = Type.Object({   rule:
Type.Optional(Type.String()),  // hex OR another token name   textMuted:
Type.Optional(Type.String()),  // pptx has none today   onPrimary:
Type.Optional(Type.String()),   surfaceInverse: Type.Optional(Type.String()),   positive:
Type.Optional(Type.String()),   negative:       Type.Optional(Type.String()),   chart:
Type.Optional(Type.Array(Type.String(), { minItems: 1, maxItems: 12 })), }, { additionalProperties:
false });  /** One neutral role spec. Each format PROJECTS it onto its own preset shape. */ export
const TypeRoleSchema = Type.Object({   face:        Type.Optional(Type.String()),  // a FONT ROLE
name (heading/body/mono/light)   weight:      Type.Optional(Type.Integer({ minimum: 100, maximum:
900 })),   size:        Type.Optional(Type.Number({ minimum: 5, maximum: 200 })),   // pt
lineHeight:  Type.Optional(Type.Number({ minimum: 0.5, maximum: 3 })),   // × size   tracking:
Type.Optional(Type.Number()),   // 1/100 em; sign = condensed/expanded   case:
Type.Optional(TextCaseSchema),   color:       Type.Optional(Type.String()),   // a PALETTE ROLE
name, not hex   spaceBefore: Type.Optional(Type.Number()),   // pt   spaceAfter:
Type.Optional(Type.Number()),   // pt }, { additionalProperties: false });  export const
TypographySchema = Type.Object({   roles: Type.Optional(Type.Object(
Object.fromEntries(TYPE_ROLES.map(r => [r, Type.Optional(TypeRoleSchema)])),     {
additionalProperties: false })),   scale: Type.Optional(Type.Object(              // one scale per
canvas     Object.fromEntries(CANVASES.map(c => [c, Type.Optional(Type.Object({       base:
Type.Number(),                 // body size in pt on this canvas       ratio:
Type.Optional(Type.Number()),  // modular ratio, default 1.25       baselinePt:
Type.Optional(Type.Number()),  // default 4 — sizes snap to it     }, { additionalProperties: false
}))])),     { additionalProperties: false })), }, { additionalProperties: false });  export const
SpacingSchema = Type.Object({   basePt:   Type.Optional(Type.Number()),        // 4   blockGap:
Type.Optional(Type.Object({     tight: Type.Optional(Type.Number()), normal:
Type.Optional(Type.Number()),     loose: Type.Optional(Type.Number()) }, { additionalProperties:
false })),   canvas: Type.Optional(Type.Object(             // safe area + grid per canvas
Object.fromEntries(CANVASES.map(c => [c, Type.Optional(Type.Object({       safeAreaIn:
Type.Optional(Type.Number()),       gutterIn:   Type.Optional(Type.Number()),       columns:
Type.Optional(Type.Integer({ minimum: 1 })),       rows:       Type.Optional(Type.Integer({ minimum:
1 })),     }, { additionalProperties: false }))])),     { additionalProperties: false })), }, {
additionalProperties: false });  /** VALUES ONLY. No presence, no archetype, no requirement. */
const RuleSchema = Type.Object({   weightPt: Type.Optional(Type.Number()), color:
Type.Optional(Type.String()), }, { additionalProperties: false }); const RecipeSchema =
Type.Object({   type:      Type.Optional(Type.String()),   // a TYPE_ROLES name   color:
Type.Optional(Type.String()),   // a palette role   fill:      Type.Optional(Type.String()),   rule:
Type.Optional(RuleSchema),   padPt:     Type.Optional(Type.Number()),   alignment:
Type.Optional(Type.Union([Type.Literal('left'),                 Type.Literal('center'),
Type.Literal('right')])), }, { additionalProperties: false });  export const ChromeSchema =
Type.Object({   runningHead: Type.Optional(RecipeSchema),  tracker: Type.Optional(RecipeSchema),
actionTitle: Type.Optional(RecipeSchema),  keyTakeaways: Type.Optional(RecipeSchema),   sourceLine:
Type.Optional(RecipeSchema),  confidentialFooter: Type.Optional(RecipeSchema),   logoSlot:
Type.Optional(RecipeSchema),  cover: Type.Optional(RecipeSchema), }, { additionalProperties: false
});  export const MotifSchema = Type.Object({      // "at most one" = a single object, not an array
kind:      Type.Union([Type.Literal('none'), Type.Literal('rule'),
Type.Literal('corner'), Type.Literal('band')]),   color:     Type.Optional(Type.String()),
weightPt:  Type.Optional(Type.Number()),   placement: Type.Optional(Type.String()), }, {
additionalProperties: false }); `` PER-FORMAT — five identical OPTIONAL root keys added to each
ThemeConfigSchema, all referencing the shared schemas above: `ts // packages/shared-
docx/src/schemas/theme.ts:431  (still additionalProperties:false)   palette:
Type.Optional(PaletteSchema),   typography: Type.Optional(TypographySchema),   spacing:
Type.Optional(SpacingSchema),   chrome:     Type.Optional(ChromeSchema),   motif:
Type.Optional(MotifSchema), // and: replace the hand-duplicated inline colors literal
(theme.ts:438-462) // with a reference to ThemeColorsSchema (theme.ts:392-416). Identical shape, //
kills the two-place-edit hazard.  // packages/shared-pptx/src/schemas/theme.ts:108  — same five,
PLUS the // metadata #333 needs and pptx lacks entirely:   displayName:
Type.Optional(Type.String()),   description: Type.Optional(Type.String()),   version:
Type.Optional(Type.String()), ` WHAT STAYS PER-FORMAT, and why — because its SHAPE is dictated by
the target file format's own model, and the two are provably incompatible: - `colors`: docx
`HexColorSchema` is `^(#[0-9A-Fa-f]{6}|[a-zA-Z][a-zA-Z0-9]*)$` (packages/shared-
docx/src/schemas/font.ts:14-17) — token names legal, bare hex illegal. pptx uses a LOCAL
`^#?[0-9A-Fa-f]{6}$` (packages/shared-pptx/src/schemas/theme.ts:76-79) — bare hex legal, token names
ILLEGAL. I probed both: pptx `{"accent4":"primary"}` fails `Value.Check`; pptx `"4472C4"` passes.
Unifying them is a breaking change to both, so the new roles go in the `palette` sibling (a plain
`Type.String()`) instead, and each format's existing resolver gains one fallback line. - `fonts`: 4
`FontDefinition` objects (docx) vs 2 bare family strings (pptx). - `styles`: docx is an open map
over `StylePropertiesSchema`; pptx is `Type.Partial` over a closed 7-name union that is ALSO every
text component's `style` prop. Zero field names in common. - `page` (docx, twips) / `defaults`
(pptx). The canvas ID for `typography.scale` and `spacing.canvas` is DERIVED, not stored: docx from
`theme.page.size`, pptx from `props.slideWidth`/`slideHeight` — so neither `page` moves out nor
`slideWidth` moves in. - `componentDefaults`: already per-format and already `additionalProperties:
true` on both sides (packages/shared-docx/src/schemas/component-defaults.ts:90, packages/shared-
pptx/src/schemas/component-defaults.ts:34), so the spec's component-defaults row is a DATA change,
not a schema change. BOUNDARY: `chrome` and `motif` carry only look. Nothing named `required*`,
`min*`, `archetype*`, or `mustHave` appears anywhere in them — a guard test pins that (see task 9).
"The consulting profile requires action titles" stays in `QualityProfile`
(packages/quality/src/types.ts:134-142), which today has fields for
id/version/description/formats/rendererTargets/parameters/rules and nothing else.

## Tasks, in order

### 1. Make ensureThemeDefaults a merge, not a whitelist rebuild — plus a round-trip guard test — DONE (#355, `ef65176`)

Risk: **low**

THE GATE. defaults.ts:138-164 returns a hand-written ten-key object literal with no spread, so every
root key outside that list is deleted after validation and before the renderer. It already loses
fontRegistry and noProofWords — both legal on ThemeConfigSchema — on the bundled registry path
(templates/themes/index.ts:36-38) and the --theme-path path (themes/json/parser.ts:104-108). Change
it to spread-then-backfill, and add a test that walks ThemeConfigSchema.properties and asserts every
key survives a round trip, so no future layer can repeat this. Golden-safe: I read all three bundled
theme files and none declares fontRegistry or noProofWords (top-level keys are exactly
name,displayName,description,version,colors,fonts,page,styles,componentDefaults).

Files:

- `packages/core-docx/src/themes/defaults.ts`
- `packages/core-docx/src/themes/__tests__/bundled-themes.test.ts`

### 2. Close the pptx theme validation holes before any extended theme file exists — DONE (#355)

Risk: **medium**

Three gaps, all confirmed. (1) isValidThemeConfig at shared-pptx/schemas/theme.ts:164-166 is `typeof
data === 'object' && data !== null` — a type-asserting no-op; I probed it with {} and it returns
true. Point it at Value.Check like the docx twin (shared-docx/schemas/theme.ts:514-516). (2) format-
adapter.ts:1271-1279 reads a pptx --theme-path .json with bare fs.readFileSync + JSON.parse, while
the docx branch at :828-829 calls core.loadThemeFromFile; route it through validatePptxTheme
(shared-pptx/src/validation/unified/index.ts:95-113). (3) core-pptx has no bundled-themes schema
test at all — mirror core-docx/src/themes/**tests**/bundled-themes.test.ts. Do this BEFORE the
schema grows: once extended pptx themes exist, a malformed one is a TypeError deep in the IR
compiler (core-pptx/src/ir/compiler.ts:613 reads ctx.theme.defaults.fontSize unguarded).

Files:

- `packages/shared-pptx/src/schemas/theme.ts`
- `packages/jto-ops/src/format-adapter.ts`
- `packages/core-pptx/src/themes/__tests__/bundled-themes.test.ts`

### 3. Fix theme-level fontWeight and add a `case` axis — MOVES ONE GOLDEN

Risk: **medium**

The type-role ladder needs per-role weight and case, and both are broken or missing at theme level
today. fontWeight IS in TextFormattingPropertiesSchema (font.ts:75-84, so it is legal on every theme
style and font role) but resolveFontProperties (styleHelpers.ts:139-151) and convertRunProperties
(themeToStyles.ts:262-282) both omit it — I read both copy lists; neither mentions it. `case` does
not exist in either format's vocabulary, but the render half already does: the IR carries smallCaps
and allCaps (core-docx/src/ir/types.ts:306-307) and both renderers emit them (renderers/office-
open/emit.ts:171-172, renderers/docxjs/styles.ts:65-66) — nothing ever sets them. GOLDEN MOVE,
exactly one and easy to justify: corpus case `theme/font-numeric-weights` (corpus-theme.ts:565-582)
sets themeOverrides.styles.heading3.fontWeight:500, which renders as nothing today. Record the row
in office-renderer-ir.md's Recorded output differences section as the fixture header requires.

Files:

- `packages/core-docx/src/styles/utils/styleHelpers.ts`
- `packages/core-docx/src/styles/themeToStyles.ts`
- `packages/shared-docx/src/schemas/font.ts`
- `packages/core-docx/src/__tests__/fixtures/corpus-goldens.ts`
- `docs/architecture/office-renderer-ir.md`

### 4. Add the shared design-system schemas with no consumer

Risk: **low**

TYPE_ROLES, CANVASES, TextCaseSchema, PaletteSchema, TypeRoleSchema, TypographySchema,
SpacingSchema, ChromeSchema, MotifSchema — exported, referenced by nothing yet, so the commit is
trivially green. packages/shared/src/theme/ already exists and holds chart-palette.ts, the repo's
only cross-format theme module, and both shared-docx and shared-pptx already import from @json-to-
office/shared. Also fix chart-palette.ts's header, which asserts 'A slot may also hold another
token's name ("accent4": "primary") — both theme schemas allow it': I probed it, pptx Value.Check
returns FALSE for that theme because shared-pptx/schemas/theme.ts:76-79 uses ^#?[0-9A-Fa-f]{6}$, not
ColorValueSchema. The comment has been wrong since it was written.

Files:

- `packages/shared/src/theme/design-system.ts`
- `packages/shared/src/theme/chart-palette.ts`
- `packages/shared/src/index.ts`

### 5. Hang the five optional sections off both ThemeConfigSchemas; de-duplicate the docx colors block

Risk: **medium**

palette/typography/spacing/chrome/motif as optional root keys on both, plus
displayName/description/version on pptx (which has only `name` today — #333 has no field to hold
'visual voice' otherwise). All optional, so createMinimalTheme (shared-
docx/schemas/theme.ts:536-593, typed as the schema's Static precisely so a new REQUIRED field breaks
the build) still compiles and every user theme still validates. Two attached chores: (a) replace the
inline colors literal at shared-docx/schemas/theme.ts:438-462 with a reference to ThemeColorsSchema
at :392-416 — I diffed them, they are verbatim identical, and the duplication is why a palette role
can be added to theme files but not to themeOverrides; (b) extend ThemeOverridesSchema
(theme.ts:418-429, closed to colors/fonts/styles) to the new sections — applyThemeOverrides already
does `...theme` (overrides.ts:40-45) so pass-through works, only AUTHORING is blocked. Mirror
everything onto PptxThemeConfig (core-pptx/src/types.ts:163-188), a hand-written interface with no
link to the schema. Playground COLOR_GROUPS/COLOR_HINTS (theme-editor/model.ts:114-124) must grow
too — its test asserts no schema colour key lands in the 'Other' group.

Files:

- `packages/shared-docx/src/schemas/theme.ts`
- `packages/shared-pptx/src/schemas/theme.ts`
- `packages/core-pptx/src/types.ts`
- `packages/core-docx/src/themes/overrides.ts`
- `packages/jto/src/client/lib/theme-editor/model.ts`

### 6. Make palette roles and the ordered chart list actually resolve

Risk: **medium**

docx resolveColor (colorUtils.ts:31-68) resolves against getThemeColors(theme) = {...DEFAULT_COLORS,
...theme.colors} and already chases references recursively — add theme.palette to that spread and
the new roles work, including aliasing (`rule: "borderPrimary"`). Also regenerate the ValidColorName
union (colorUtils.ts:7-19), a hand-written 12-name list already missing accent4-6. pptx resolveColor
(utils/color.ts:93-134) gets the same fallback ahead of its primary-substitution path. The ordered
chart list is a shape change (array vs six named scalars) across three independent implementations
of the same skip-unset rule — core-docx/ir/compiler.ts:3704, core-docx/components/highcharts.ts:119,
core-pptx/utils/color.ts:76 — so have all three read theme.palette.chart first and keep
DEFAULT_CHART_THEME_COLORS as the fallback. Finally, fold palette scalars into paletteHexes in both
quality fact builders (core-docx/quality/facts.ts:636-644 and core-pptx/quality/facts.ts:886-895
both iterate colors only and both `continue` on a non-string), or Phase 0's off-palette rule loses
coverage exactly as the palette grows.

Files:

- `packages/core-docx/src/styles/utils/colorUtils.ts`
- `packages/core-pptx/src/utils/color.ts`
- `packages/core-docx/src/ir/compiler.ts`
- `packages/core-docx/src/components/highcharts.ts`
- `packages/core-docx/src/quality/facts.ts`
- `packages/core-pptx/src/quality/facts.ts`

### 7. Compile the type-role ladder and the per-canvas scale in both formats

Risk: **high**

docx: project typography.roles into real Word styles through the existing custom-style loop
(themeToStyles.ts:791-880), and fix getStyleSafe (themeToStyles.ts:132-158) first — it gates on a
hardcoded nine-name isValidStyleName, so every role name hits `console.warn('Invalid style name:
eyebrow')` and resolveStyleWithBaseStyle returns undefined, falling through to `|| styleValue` at
:810: the style still emits but its baseStyle is silently ignored. No bundled theme trips this today
(I checked: their style keys are only normal/title/subtitle/heading1-6/TOC1-3), so it is latent
until roles arrive. pptx: project roles into fontCascade (ir/compiler.ts:712-730) and replace
namedStyle's `/^(title|heading)/` heading heuristic (:697) with the role's declared `face`, or
`display` and `eyebrow` silently take the body font. Canvas is derived, not stored: docx from
theme.page.size via getPageSetup (layoutUtils.ts:232-266), pptx from props.slideWidth/slideHeight —
which are on the very props object resolveThemeContext already reads (core-
pptx/core/generationContext.ts:61-124), so it is a cheap read, not a schema move. Golden-safe as
long as this lands before #329: no shipped theme declares typography.

Files:

- `packages/core-docx/src/styles/themeToStyles.ts`
- `packages/core-pptx/src/ir/compiler.ts`
- `packages/core-pptx/src/core/generationContext.ts`
- `packages/core-docx/src/styles/utils/layoutUtils.ts`

### 8. Chrome recipes and motif: wire the dead Header/Footer styles — MOVES GOLDENS — SPLIT TO #328b

Risk: **high**

This is the layer with zero prior art. The Header and Footer paragraph styles are DEFINED at
themeToStyles.ts:740 and referenced by nothing — compileChromeParagraph pins styleId:'Normal'
(ir/compiler.ts:842) and rebuilds family/size/colour per run from getNormalStyle. Chrome recipes
need one of those two to give: either chrome paragraphs start naming Header/Footer, or the recipe
feeds the per-run defaults built at ir/compiler.ts:821-838. The first is cleaner and MOVES GOLDENS
for every corpus case with a header or footer, so it needs its own explanatory row in office-
renderer-ir.md. Note chrome paragraphs support only text/alignment/font/spacing today — no indent,
no tab stops, no borders — so a confidential footer with `n / N` right-aligned needs tab-stop
support in the chrome path as well. Splittable into its own #328b if the gate needs to open sooner.

Files:

- `packages/core-docx/src/styles/themeToStyles.ts`
- `packages/core-docx/src/ir/compiler.ts`
- `packages/core-docx/src/__tests__/fixtures/corpus-goldens.ts`
- `docs/architecture/office-renderer-ir.md`

### 9. Pin the theme/profile boundary with a guard test

Risk: **low**

#328's criterion 'a non-consulting profile can use the theme without false required-chrome findings'
is vacuously true today — profiles are severity and parameter tuning only (QualityProfile at
packages/quality/src/types.ts:134-142 has no presence field, and of the five shipped profiles only
two set anything: core-docx/quality/rules.ts:661-680 and core-pptx/quality/rules.ts:804-819), and no
blueprint concept exists anywhere. Write the test now as a pinned regression so it fails the day the
first requirement lands in the wrong place: walk ChromeSchema and MotifSchema recursively and assert
no property name matches /^(required|min|max|must|archetype)/i, and that no chrome recipe carries a
count or a presence flag. Cheap, and it is the only mechanical defence of the spec's central line.

Files:

- `packages/shared/src/theme/__tests__/boundary.test.ts`
- `packages/shared/src/theme/design-system.ts`

### 10. Widen discovery's theme list to objects, and hand-update the theme docs

Risk: **low**

CatalogFormat.themes is `string[]` (discover.ts:597), fed by builtinThemeNames (:366-382) and echoed
by jto://themes (resources/index.ts:100-149). #333 needs description and when-to-use per theme, and
#331 needs to list aliases; both are blocked on the shape, so the shape change belongs here in the
gate. Note jto://themes/values serialises whole theme objects (:118-140) and will grow noticeably
once themes carry type scales and chrome recipes — worth deciding whether the design guide carries a
summarised view instead. Docs are pure hand work with no generator and no drift check:
docs/reference/theme-schema.md:9-30 states '13 required keys' and 'No other key is accepted', and
docs/guide/themes.md repeats the palette vocabulary. Nothing fails if they are missed — three theme
names deleted in 2d1a10b are still documented in packages/mcp-server/README.md:158.

Files:

- `packages/mcp-server/src/tools/discover.ts`
- `packages/mcp-server/src/resources/index.ts`
- `docs/reference/theme-schema.md`
- `docs/guide/themes.md`

## Decisions this needs before it starts — SETTLED 2026-09-05

Answered by Paolo on 2026-09-05, after Phase 0 merged (#355). Each answer is recorded under its
question with the evidence it rests on; the questions are kept verbatim so the reasoning stays
readable next to what was asked.

Two of the ten did not survive contact with the code. **#9's binary is false** — the map asks
whether `light` is repurposed or retired and the answer is neither. **#10's arithmetic is wrong in
the direction that matters**, and is corrected in place below rather than left for a reader to
trust.

1. New palette roles as a `palette` sibling block (my proposal), or widen both closed `colors`
   objects?

**Settled: the `palette` sibling.** Widening is not a design choice, it is a breaking change to
both formats. The two `colors` schemas use hex patterns where neither is a superset of the other —
docx `HexColorSchema` is `^(#[0-9A-Fa-f]{6}|[a-zA-Z][a-zA-Z0-9]*)$` (shared-docx/schemas/font.ts:14),
pptx is a local `^#?[0-9A-Fa-f]{6}$` (shared-pptx/schemas/theme.ts:78). A token name like
`"positive": "accent"` is legal in docx and rejected by pptx; a bare `1B3A5C` is the other way
round. `palette` values are a plain `Type.String()`, so both formats accept either, and the cost is
one fallback line per resolver. It is also reversible: `palette` can fold into `colors` in a future
major once the patterns are unified.

2. Do new roles become authorable component colours? Adding to SEMANTIC_COLOR_NAMES regenerates every
   pptx component schema.

**Settled: no, not in #328.** Adding to `SEMANTIC_COLOR_NAMES` regenerates every pptx component
schema — a large change to the published surface in exchange for a convenience. The roles resolve
in the theme, which is where they are consumed. Revisit if a component ever needs to name one
directly.

3. Type roles as one neutral shared vocabulary (my proposal), or format-native styles that cannot
   share tokens?

**Settled: one neutral shared vocabulary.** The point of Phase 1 is that a paired deck and report
match; format-native styles that cannot share tokens defeat that by construction. `TypeRoleSchema`
already projects onto each format's own preset shape, which is where the formats are allowed to
differ.

4. `sage` would name two unrelated designs — docx Calibri sage-green, pptx Helvetica greyscale. One
   name or two?

**Settled: two names.** One name meaning Calibri sage-green in docx and Helvetica greyscale in pptx
is precisely the "a theme swap changes colours, not design" failure this programme exists to end.
Cheap to fix now, expensive once #331's aliases ship it.

5. Chrome recipes + motif inside #328, or split to #328b so the gate opens sooner?

**Settled: split to #328b.** Task 8 is the only high-risk task, the only one that moves goldens en
masse, and the only one that needs machinery that does not exist — chrome paragraphs carry
text/alignment/font/spacing and no tab stops, so a `n / N` right-aligned confidential footer needs
the chrome path widened first. Nothing behind the gate wants it: #329–#333 need palette, typography
and spacing, and chrome recipes' only consumer is Phase 2's blocks (#334–#337). Splitting opens the
gate for five issues and isolates the one task with zero prior art.

6. PptxThemeConfig rewritten as Static<typeof ThemeConfigSchema>, or keep the hand interface plus an
   agreement test?

**Settled: rewrite as `Static<typeof ThemeConfigSchema>`.** The hand interface has already drifted
from the schema — `core-pptx/src/themes/__tests__/bundled-themes.test.ts` exists because nothing ran
the built-in themes past `ThemeConfigSchema` while `tsc` checked them against the interface.
Deriving the type removes the class of bug; an agreement test keeps two things in sync forever.

7. Does docx `props.theme` gain an inline-object branch, for pptx parity?

**Settled: yes, but a separate ticket.** Parity worth having, not a gate dependency, and nothing in
#328–#333 waits on it.

8. fontWeight fix and `case` inside #328 (moves one golden), or a separate ticket?

**Settled: inside #328.** The type-role ladder cannot be built without per-role weight, and the fix
moves exactly one golden. Splitting a one-golden change costs more ceremony than it saves.

9. Is the docx `light` font role repurposed as `display`, or retired? It duplicates `heading` in all
   three themes and no style references it.

**Settled: neither — leave `light` alone.** The question offers a false binary. The claim it rests
on ("no style references it") is true of the three bundled themes and false of the corpus:
`core-docx/src/__tests__/fixtures/corpus-theme.ts` uses `font: 'light'` in three cases, so it is a
live component prop with golden coverage. Retiring it breaks that prop; repurposing it as `display`
silently changes what existing documents render. The two are different axes anyway — `light` is a
font _family_ slot, `typography.roles.display` is a type role — so they do not compete. Give
`display` its own role and leave `light` where it is.

10. Does the corpus get pinned to a frozen theme, so #331 moves ~26 goldens instead of ~337?

**Settled: pin the corpus — and the question's arithmetic is backwards.** Verified 2026-09-05:
there are 273 docx goldens and 64 pptx (337 together, which is where the "~337" came from — it was
the total, not the docx move). Only 31 docx fixtures name a theme (26 `minimal`, 3 `devportal`,
2 `vermilion`) and **not one of the 113 pptx cases names one at all**. Theme-less docx resolves to
`minimal` at `core-docx/src/core/generationContext.ts:97`, which is exactly what #331 repoints.

So the 26 that pin `minimal` are the ones that would NOT move, and unpinned #331 moves roughly
242 docx + all 64 pptx ≈ **306 goldens**, not 26. Pinning is a mechanical commit — ~306 fixtures
gain an explicit theme and no golden moves, because the resolved theme is identical — after which
#331 moves ~0. The diff under review becomes "fixtures made explicit" instead of "306 goldens
moved".

## Tripwires

Each of these is a way the work fails silently — not a way it errors. Every one carries the evidence
that found it, so a reader can check it rather than believe it.

**1. Every new top-level theme layer is silently deleted before any consumer runs — validation passes, generation succeeds, the design is just absent.**

Evidence: packages/core-docx/src/themes/defaults.ts:138-164 returns a hand-written ten-key object
literal with no spread. It already drops `fontRegistry` and `noProofWords`, both legal on
ThemeConfigSchema (packages/shared-docx/src/schemas/theme.ts:464, :469). It runs on the bundled
registry (templates/themes/index.ts:36-38) and on --theme-path (themes/json/parser.ts:104-108).

**2. A palette role added in one place validates theme files but not themeOverrides, with no test failure.**

Evidence: packages/shared-docx/src/schemas/theme.ts:392-416 declares ThemeColorsSchema (which feeds
ThemeOverridesSchema at :420); :438-462 re-declares the same sixteen keys inline inside
ThemeConfigSchema. I diffed them — verbatim identical, including the comment about accent4-6.

**3. The pptx palette rejects token references, so any design that aliases one role to another fails validation — and the repo's own contract doc says the opposite.**

Evidence: Probed with Value.Check against packages/shared-pptx/src/schemas/theme.ts:
`{colors:{accent4:'primary'}}` → false; `{colors:{primary:'4472C4'}}` → true. The pattern at
theme.ts:76-79 is a LOCAL `^#?[0-9A-Fa-f]{6}$`, not ColorValueSchema.
packages/shared/src/theme/chart-palette.ts:22-24 asserts 'both theme schemas allow it', and
packages/core-pptx/src/utils/color.ts:36-38 repeats the claim.

**4. A malformed extended pptx theme file reaches the renderer unvalidated and fails as a TypeError deep in the compiler, not as a diagnostic.**

Evidence: packages/jto-ops/src/format-adapter.ts:1271-1279 does fs.readFileSync + JSON.parse for a
pptx --theme-path .json; the docx branch at :828-829 calls core.loadThemeFromFile. packages/core-
pptx/src/ir/compiler.ts:613 reads ctx.theme.defaults.fontSize unguarded, and pptx has no
ensureThemeDefaults at all.

**5. The obvious-looking pptx theme guard is an unconditional pass, so Phase 1 code that reaches for it gets no validation.**

Evidence: packages/shared-pptx/src/schemas/theme.ts:164-166 is `typeof data === 'object' && data !==
null`. I probed it: isValidThemeConfig({}) returns true. It is exported from packages/shared-
pptx/src/index.ts:117 with zero call sites. The docx twin at packages/shared-
docx/src/schemas/theme.ts:514-516 is a real Value.Check.

**6. A theme built on a weight ladder renders flat: theme-level fontWeight is accepted by the schema and dropped by the style compiler.**

Evidence: fontWeight is declared in TextFormattingPropertiesSchema (packages/shared-
docx/src/schemas/font.ts:75-84) and therefore legal on every theme style and font role, but
resolveFontProperties (packages/core-docx/src/styles/utils/styleHelpers.ts:139-151) and
convertRunProperties (packages/core-docx/src/styles/themeToStyles.ts:262-282) both omit it from
their explicit copy lists. Corpus case `theme/font-numeric-weights` (corpus-theme.ts:580) already
exercises the dead path.

**7. A type role expressed as a named docx style logs a console warning on every render and silently loses its baseStyle inheritance.**

Evidence: packages/core-docx/src/styles/themeToStyles.ts:132-144 gates on a hardcoded nine-name
isValidStyleName; :149-158 getStyleSafe console.warns 'Invalid style name: X' and returns undefined
for anything else; :810 then falls through to `|| styleValue`, so the style emits but its baseStyle
is never resolved. Latent today — I checked all three bundled themes and their style keys are only
normal/title/subtitle/heading1-6/TOC1-3.

**8. Every pptx schema field must be hand-mirrored into a duplicate interface, and nothing fails the build if you forget — the compiler simply cannot see it.**

Evidence: packages/core-pptx/src/types.ts:163-188 PptxThemeConfig, :154-161 StyleName, :136-152
TextStyle are hand-written duplicates of the schema, none declared as Static<typeof …Schema>.
DEFAULT_PPTX_THEME is annotated `: PptxThemeConfig` (packages/core-pptx/src/themes/defaults.ts:40).

**9. Chrome recipes have no working style hook: the Header and Footer styles the theme compiles are referenced by nothing.**

Evidence: packages/core-docx/src/styles/themeToStyles.ts:740 defines Header and Footer, but
compileChromeParagraph pins styleId:'Normal' (packages/core-docx/src/ir/compiler.ts:842) and
rebuilds every run from getNormalStyle at :821-838. Grepping the style ids finds only their
definitions.

**10. Adding a name to STYLE_NAMES is a document-schema change, not a theme change — it alters the `style` prop union on every pptx text component.**

Evidence: packages/shared/src/schemas/slide-content/theme.ts:45-58 builds StyleNameSchema from
STYLE_NAMES, and packages/shared-pptx/src/schemas/theme.ts:144-153 builds the theme's `styles`
object from the same list. packages/core-pptx/src/ir/compiler.ts:697 then decides heading-vs-body
face by the regex /^(title|heading)/ on the style name, which every new role name falls through to
body.

**11. The two formats' `themeName` facts mean different things, so any cross-format rule or design guide keyed on it reads inconsistent values.**

Evidence: packages/core-docx/src/quality/facts.ts:648 reports context.themeName — the LOOKUP KEY,
which is the literal 'jto-cli-theme' for every --theme-path render (packages/jto-ops/src/format-
adapter.ts:154, :163-177 rewrite props.theme to that reserved key). packages/core-
pptx/src/quality/facts.ts:898 reports processed.theme.name — the theme's own identity.

**12. New palette roles drop out of the Phase 0 off-palette rule and the playground editor unless they are flat string leaves.**

Evidence: packages/core-docx/src/quality/facts.ts:636-644 and packages/core-
pptx/src/quality/facts.ts:886-895 both iterate theme.colors only and `continue` on a non-string
value, so an ordered chart array is invisible to them. packages/jto/src/client/lib/theme-
editor/model.ts:132-174 reads schema.properties.colors.properties as a flat key list, and its test
asserts no key lands in the 'Other' group.

**13. pptx has no in-document override channel at all, and docx's is closed to three keys — so the new layers ship un-tweakable unless both grow.**

Evidence: packages/shared-docx/src/schemas/theme.ts:418-429 is closed to colors/fonts/styles.
packages/core-docx/src/themes/overrides.ts:40-45 does spread `...theme`, so unknown layers survive
the MERGE — only authoring is blocked. pptx has no themeOverrides step anywhere in core-pptx; its
only path is a full inline theme object (packages/core-pptx/src/core/structure.ts:65-71).

**14. pptx resolves the theme in two independent places, so a precedence rule applied to only one is silent.**

Evidence: packages/core-pptx/src/core/generationContext.ts:88-105 and packages/core-
pptx/src/core/structure.ts:65-71 each implement inline-object → customThemes → getPptxTheme.
processPresentation skips its copy only when options.theme is passed. docx has one (packages/core-
docx/src/core/generationContext.ts:96-111).

**15. A typo'd component default or chrome recipe nested under componentDefaults validates and does nothing, in both formats.**

Evidence: packages/shared-docx/src/schemas/component-defaults.ts:90 is `additionalProperties: true`
(with a TODO); packages/shared-pptx/src/schemas/component-defaults.ts:34 likewise. Both cores apply
defaults for unlisted names through a generic fallback (packages/core-
docx/src/styles/utils/resolveComponentTree.ts:70-77).

## What the critics said the map missed

### Lens: Completeness — every requirement of §5B and every acceptance criterion of #328/#329/#330/#331/#333 mapped onto a task, plus every consumer that would need plumbing and every test suite that would break.

Strong on the schema seam and on failure modes inside #328; I re-verified the gate
(`ensureThemeDefaults` at packages/core-docx/src/themes/defaults.ts:136-164 is a ten-key literal
with no spread), the pptx no-op guard, the docx colors duplication, the dead Header/Footer styles,
the nine-name `isValidStyleName`, and the theme-level `fontWeight` omission
(styleHelpers.ts:139-151, themeToStyles.ts:262-282) — all accurate. But the map is scoped to #328's
schema and its resolvers, and it silently drops most of Phase 1 around it. Three whole rows of the
§5B table (Fonts, Component defaults, and the docx authoring surface for type roles) have no task
and are all understated as data-only; #331 has no task at all despite being the ticket with the
largest blast radius; #333's two substantive criteria (a generated design-guide resource and a drift
test) are reduced to "widen the themes list to objects"; and the deliverables that are ACs on
#328/#329/#330 — new goldens in both pipelines, a docs gallery with generated previews, a pptx theme
authoring path — appear nowhere. The map also under-counts the golden move by exactly the pptx
corpus, which it never mentions: all 64 pptx goldens render on `default`.

#### Blocking (6)

- **#331 (default switch + aliases) has no task, only one decision question — and every fallback it
  must move is hardcoded in a different package. `resolveTheme` returns `themes.minimal` in both
  adapters (packages/jto-ops/src/format-adapter.ts:806 and :1251); the docx style layer falls back
  with `getTheme('minimal')` (packages/core-docx/src/styles/utils/styleHelpers.ts:49) and
  `themeToStyles.ts:429,434`; the registry's own fallback is `fallbackTheme = 'minimal'`
  (packages/core-docx/src/templates/themes/index.ts:115); the unauthored-theme default is
  `'minimal'` (packages/core-docx/src/core/generationContext.ts:97) and `'default'`
  (packages/core-pptx/src/core/structure.ts:72-73, generationContext.ts:100). None of these is a
  task, and none of them distinguishes an alias from a name.**
  <br>Verified each line. Aliases additionally have no shape to live in: discovery derives theme names
  from `Object.keys(themes)` (packages/mcp-server/src/tools/discover.ts:366-381 and packages/mcp-
  server/src/lib/render-options.ts:141-160), so `office`/`office-dark`/`sage` would appear as
  ordinary sibling names, which cannot satisfy #331's criterion 'Docs and the discovery output
  list the aliases'.
- **The golden move is counted for docx only. The pptx corpus has 64 goldens (packages/core-
  pptx/src/**tests**/fixtures/corpus-goldens.ts:20-149) and NOT ONE of its 113 cases names a theme
  — grep for `theme` in packages/core-pptx/src/**tests**/fixtures/corpus.ts returns nothing — so
  every pptx case renders on `default`, and #331 moves all 64. The map's decision question ('~26
  goldens instead of ~337') is a docx-only framing.**
  <br>docx corpus theme usage: 26 cases `theme: 'minimal'`, 3 `'devportal'`, 2 `'vermilion'`; the
  remaining ~300 are theme-less and resolve through generationContext.ts:97 to `minimal`, which
  #331 repoints at the house theme. pptx: 0 cases name a theme, 64 goldens.
- **#328 criterion 2 — 'New visual layers change output through both generation pipelines and are
  visible in goldens' — has no task. The map's only golden movement is an incidental one from the
  fontWeight bug fix. Nothing adds corpus cases exercising typography roles, per-canvas scale,
  spacing, chrome or palette roles, and the pptx corpus has no theme case to extend at all.**
  <br>packages/core-docx/src/**tests**/fixtures/corpus-theme.ts is the only theme corpus (docx);
  packages/core-pptx/src/**tests**/fixtures/corpus.ts has no theme cases. core-pptx also carries
  pipeline-parity.test.ts, which the map never mentions even though task 7 edits both pptx compile
  paths.
- **The bundled template gallery — Phase 0's own deliverable — silently re-themes under #331 and its
  generated manifest check fails. packages/mcp-server/assets/gallery.json records a `theme` per
  template: five docx templates on `minimal` (lines 111,138,222,251,277), one on `default` (line
  180, a docx theme that does not exist and already falls back), three pptx `inline`.
  scripts/generate-gallery.ts bakes the documents, real LibreOffice thumbnails and that manifest,
  and `--check` fails on any drift; it is wired into `pnpm validate:assets`. Regenerating needs
  LibreOffice + poppler. No task.**
  <br>scripts/generate-gallery.ts header ('Regenerating needs LibreOffice and poppler … `--check` re-
  derives everything and fails when anything moved, and `pnpm validate:assets` runs it') plus
  package.json:"validate:assets": "tsx scripts/validate-shipped-assets.ts && pnpm check:gallery".
- **The quality calibration corpus is pinned to the theme names Phase 1 repurposes, and no task
  acknowledges it. packages/jto-ops/src/quality-reference-corpus.ts:54 and :123 build synthetic
  reference documents with `props: { theme: 'minimal' }`, and STOCK_REFERENCE_TEMPLATES (:21-30)
  asserts the eight gallery templates as reference-quality with an expected diagnostic list. #331
  re-themes all of them; #329/#330 rewriting vermilion and devportal values re-evaluates Phase 0's
  off-palette, contrast and font-count rules against different palettes.**
  <br>Read the file; the header comment states the list is 'the calibration bar for the quality
  rules'.
- **The §5B Fonts row has no task, and one of its two halves needs a schema field that does not
  exist. 'alternates may register Google or libre families through fontRegistry with a declared
  safe substitute' — FontRegistryEntrySchema (packages/shared/src/schemas/font-catalog.ts:229-252)
  is `additionalProperties: false` over id/family/category/sources only. The substitute is derived
  today by a category heuristic (`defaultSubstituteFor`,
  packages/shared/src/fonts/substitute.ts:~210-226) or supplied at call time via the runtime
  `fonts.substitution` option — never declared in theme data. #330's criterion 'verified under
  substitution' rests on it.**
  <br>Read the schema and buildDefaultSubstitutionMap (substitute.ts:234-246).

#### Other (12)

- **Any new theme key that holds a font family is invisible to font validation and to substitute
  mode, and the code says so out loud. packages/shared/src/fonts/collect.ts:20 is `THEME_FONT_KEYS
= new Set(['heading','body','mono','light'])` and :10-18 `FONT_NAME_KEYS`; substitute.ts walks
  the same two sets ('Future component-schema additions that introduce new font keys go in
  FONT_NAME_KEYS / THEME_FONT_KEYS once, both sides pick them up'). `applyExportMode` rewrites the
  theme through exactly that walker (substitute.ts:323-352). A chrome recipe or type role carrying
  a face therefore neither warns FONT_UNRESOLVED nor gets substituted. No task pins the two sets
  to the new schema.**
  <br>Read collect.ts:10-30 and substitute.ts:290-352; the sync requirement is stated in both files'
  comments.
- **Task 3 treats the weight axis as two missing copy-list entries. It is not: a numeric weight is
  implemented as family-name synthesis — packages/shared/src/fonts/synthesize.ts:61-95 turns
  weight 300 into the family `Calibri Light` and any unlabelled weight into a `>=600` bold guess
  with `nonCanonicalWeight: true`. A SAFE_FONTS-only house theme (#329's criterion 'Every
  referenced font is in SAFE_FONTS') carrying a per-role weight ladder therefore emits non-safe
  family names into the very validator that criterion is checked with
  (packages/shared/src/fonts/validator.ts, FONT_UNRESOLVED).**
  <br>Read synthesize.ts:61-95 and packages/core-docx/src/ir/compiler.ts:3100-3160 (`runFormatting` →
  `applyFontWeightAlias`).
- **The §5B component-defaults row is called 'a DATA change, not a schema change'. It is neither,
  for most of what the row names. docx ComponentDefaultsSchema (packages/shared-
  docx/src/schemas/component-defaults.ts:79-90) has eight keys — heading, paragraph, image,
  statistic, table, section, columns, list — and no chart, highcharts, divider, text-box, toc or
  visual, although all six components exist in packages/shared-docx/src/schemas/components/.
  Worse, the axes the spec names do not exist as props at all: table has no zebra/banding/notes-
  row/numeric-alignment (packages/shared-docx/src/schemas/components/table.ts:253-320; grep for
  zebra|striped|alternat across shared-docx and core-docx finds nothing outside a table style
  preset in layoutUtils.ts:123). So 'table (header treatment, zebra, numeric alignment, padding,
  notes row)' and 'chart (palette, gridlines, label type, source line)' are component-props
  changes that regenerate document.schema.json and add positions to the schema-driven unknown-key
  guard.**
  <br>packages/core-docx/src/core/**tests**/unknown-key-guard.test.ts enumerates every
  `additionalProperties:false` object from the live props schemas, so a new prop object is swept
  in automatically.
- **docx type roles have an authoring surface, and it fails silently on a theme swap — with the
  dangling-style check deliberately defeated. `themeStyle` is a free string (packages/shared-
  docx/src/schemas/components/paragraph.ts:179); packages/core-docx/src/ir/compiler.ts:1069 maps
  it to a styleId verbatim (:3313-3323) and :1070 ADDS it to `ctx.styleIds`, which is exactly the
  set the IR validator checks for dangling styles (packages/core-docx/src/ir/validation.ts:171,
  :244). So `themeStyle: 'eyebrow'` on a theme that does not define the role emits a `w:pStyle`
  pointing at nothing and renders as Normal, with no diagnostic. A shared role vocabulary makes
  that the normal case. Also: heading has no `themeStyle` at all, so roles are unreachable from
  headings.**
  <br>Read compiler.ts:1069-1070 and 3313-3345, validation.ts:84-93/171/244, paragraph.ts:179.
- **Task 7 projects roles through `convertRunProperties`, which hardcodes Arial: packages/core-
  docx/src/styles/themeToStyles.ts:264 is `fontFamily: merged.family || 'Arial'`. A role that
  declares size/weight/case but no face renders Arial, not the theme's body family — precisely the
  flat-and-generic outcome §5B exists to remove. Not mentioned.**
  <br>Read themeToStyles.ts:258-284.
- **#330 needs a pptx theme authoring path that does not exist, and the map's task 2 (validation
  holes) is not it. docx themes are JSON files statically imported and schema-validated
  (packages/core-docx/src/templates/themes/index.ts:20-22, 35-38, plus json/loader.ts, parser.ts,
  validator.ts and a bundled-themes test). pptx themes are TS object literals in packages/core-
  pptx/src/themes/defaults.ts:40-113 with no JSON loader, no `loadThemeFromFile`, no registry
  validation — and all three share ONE `DEFAULT_STYLES` object by reference (:30-38, referenced at
  :62, :88, :113). Four extended pptx themes (#329 consulting, #330 vermilion + devportal, #331
  office/office-dark/sage) either need the JSON path built or hundreds of lines of hand-written
  TS.**
  <br>Read both registries.
- **#333 is reduced to widening `CatalogFormat.themes` to objects. Its two substantive criteria have
  no task: `jto://guide/design/<format>` generated from theme + profile + rule data, and a drift
  test across discovery, resources and enforcement. The thing that must become generated already
  exists as hand-written prose from Phase 0 — packages/mcp-server/src/lib/design-notes.ts (lines
  23, 33, 39, 45, 53, 56, 64, 66 all give theme advice, e.g. 'Set the series colours from theme
  tokens'), consumed by tools/discover.ts:37 and tools/describe-component.ts:28 — and
  SERVER_INSTRUCTIONS (packages/mcp-server/src/server.ts:45) must point at the guide. None is
  named.**
  <br>Read design-notes.ts and its two importers; #333 criteria 2-4 quoted from the issue.
- **The docs gallery is a Phase 1 deliverable and an acceptance criterion on both #329 ('Gallery
  shows a generated docx report page and pptx content slide') and #330 ('The gallery page shows
  both alternates in both formats'), and §7 requires 'a gallery page per theme … with generated
  previews'. There is no such infrastructure: scripts/ contains generate-gallery.ts, which bakes
  the MCP _template_ gallery into packages/mcp-server/assets, a different artefact; docs/ has no
  theme gallery and no preview generator. The map's task 10 covers only hand-edited reference
  prose.**
  <br>ls scripts/ and docs/; read scripts/generate-gallery.ts:1-40 (SOURCE_DIR =
  packages/jto/src/client/public/templates → ASSETS = packages/mcp-server/assets).
- **The one place both formats meet inside a single document passes only a pptx theme NAME, so
  'paired variants share tokens' fails within a docx report. packages/core-
  docx/src/components/visual.ts:41 — `if (canvas.theme) presentationProps.theme = canvas.theme` —
  is the whole of the theme plumbing into the embedded pptx render; the docx theme's tokens never
  reach it. Under #331 a `visual` whose canvas names no theme renders on the house pptx theme
  inside a report that may be on `sage`.**
  <br>Read buildVisualPresentation (visual.ts:32-56).
- **#329's criterion 'Both formats … render the example set warning-clean' is unowned, and the
  example set is already broken. examples/ holds 8 docx documents on `vermilion` and quarterly-
  review.pptx.json on `corporate` — a pptx theme that does not exist (pptx ships
  default/dark/minimal), so it silently falls back today. examples/ is consumed by packages/mcp-
  server/src/**tests**/preview-render.test.ts. Rewriting vermilion for #330 changes all eight.**
  <br>grep '"theme"' examples/\*.json; packages/core-pptx/src/themes/defaults.ts:65-113 lists the three
  pptx theme names.
- **Two smaller #331 surfaces the map misses, both baked into generated artefacts: packages/shared-
  docx/src/schemas/components/report.ts:16-20 puts `default: 'minimal'` and `examples:
['minimal','devportal','vermilion']` into the root props schema — i.e. into
  schemas/document.schema.json and the Monaco completion hints — and packages/shared-
  docx/src/types/common.ts:3 is already stale (`ThemeName = 'minimal' | 'verizon' | 'a2a' |
'hitachi'`). packages/jto/src/client/components/playground/unavailable-theme-warning.tsx:10-11
  hardcodes both formats' theme name lists.**
  <br>Read all three files.
- **Internal inconsistency, worth resolving before task 5 is written: the map says the playground
  COLOR_GROUPS/COLOR_HINTS 'must grow too', but under its own palette-sibling design the `colors`
  keys do not change, so the test it cites would never fire — packages/jto/src/client/lib/theme-
  editor/**tests**/model.test.ts:23-32 asserts only that docx colour tokens equal the schema's
  `colors` keys and that none groups as 'Other'. Separately, §10 lists 'Playground changes' as an
  explicit non-goal while task 5 edits playground source.**
  <br>Read model.test.ts:23-54 and model.ts:1-14; spec §10.

### Lens: Correctness review: I opened every file and line the map cites and checked each merge/precedence/shape claim against the code, plus the spec section 5B it is implementing.

The tripwires are almost all real and well-cited — I confirmed the `ensureThemeDefaults` whitelist
(core-docx/src/themes/defaults.ts:138-164, reached from templates/themes/index.ts:36-38,72 and
themes/json/parser.ts:104-107 via loadThemeFromFile → themeParser.parse → applyDefaults), the no-op
pptx guard (shared-pptx/src/schemas/theme.ts:164-166), the pptx `fs.readFileSync`+`JSON.parse` theme
path (jto-ops/src/format-adapter.ts:1271-1279 vs the docx `core.loadThemeFromFile` at :828), the
duplicated docx colors block (shared-docx/src/schemas/theme.ts:392-416 vs :438-462, verbatim
identical), the dead Header/Footer styles (themeToStyles.ts:745,761 defined; ir/compiler.ts:842 pins
`styleId: 'Normal'`), the nine-name `isValidStyleName` gate (themeToStyles.ts:131-158, fallthrough
at :810), the dropped theme-level `fontWeight` (styleHelpers.ts:139-151, themeToStyles.ts:262-282),
the missing core-pptx bundled-theme test (no `packages/core-pptx/src/themes/__tests__/` exists), and
the hand-mirrored `PptxThemeConfig` (core-pptx/src/types.ts:163-188). But three premises are wrong
in ways that change the plan, not just its wording: (a) Task 5 repeats Task 1's exact bug —
`applyThemeOverrides` reads only colors/fonts/styles, so adding sections to ThemeOverridesSchema
without touching it makes authored overrides validate and vanish; (b) the component-defaults row is
not a data change — docx defaults are `Type.Partial(<ComponentPropsSchema>)`, so every new default
in the spec needs a component props change, and no task in the map covers it; (c) Task 7's pptx half
has no addressing mechanism, and contradicts the map's own STYLE_NAMES tripwire. Task 3's "exactly
one golden" is also optimistic given how docx weight is actually realized. Fix those four and the
ordering is sound; the gate should not open on the schema shape as written.

#### Blocking (3)

- **Task 5's rationale for extending ThemeOverridesSchema is backwards, and reproduces Task 1's
  failure mode in the same commit that is supposed to prevent it. The map says
  "applyThemeOverrides already does `...theme` (overrides.ts:40-45) so pass-through works, only
  AUTHORING is blocked." The `...theme` spread passes through the BASE THEME's sections, not the
  OVERRIDES'. The function reads exactly three keys off `overrides` and returns `{ ...theme,
colors, fonts, styles }` — an authored `themeOverrides.palette` or `themeOverrides.typography`
  is never read. So Task 5 as scoped ships a schema that accepts five new override sections and
  silently discards all five: validation passes, generation succeeds, the design is absent. Task
  5's file list includes overrides.ts but its `why` explicitly argues no merge work is needed.**
  <br>packages/core-docx/src/themes/overrides.ts:23-46 — the whole body is `if (!overrides) return
theme;` then a fonts loop over `overrides.fonts`, a styles loop over `overrides.styles`, and
  `return { ...theme, colors: { ...theme.colors, ...(overrides.colors ?? {}) }, fonts,
...(Object.keys(styles).length > 0 && { styles }) }`. Nothing else on `overrides` is read. Also
  note `ThemeOverrides` at overrides.ts:8-12 is a HAND-WRITTEN interface with three fields, not
  `Static<typeof ThemeOverridesSchema>` — a second hand-mirrored duplicate the map only spotted on
  the pptx side (core-pptx/src/types.ts:163-188), so widening the schema does not even produce a
  type error here.
- **"The spec's component-defaults row is a DATA change, not a schema change" is wrong, and it hides
  what is probably the largest chunk of #328. `additionalProperties: true` on
  ComponentDefaultsSchema admits an unknown COMPONENT NAME key; it does not widen the per-
  component default shapes. Each declared component's defaults are derived from that component's
  own props schema, so every item in the spec's component-defaults row that is not already an
  authorable prop (table zebra striping / notes row, chart gridlines / label type / source line,
  image radius / border / caption, shape stroke, divider) requires extending the component props
  schema — which regenerates every schema artifact, moves the Monaco completions, and needs
  renderer work in both backends. No task in the ordered list covers this at all, yet §5B lists it
  as a Phase 1 layer and #328's title names "component defaults".**
  <br>packages/shared-docx/src/schemas/component-defaults.ts:47-77 — `HeadingComponentDefaultsSchema =
Type.Partial(Type.Omit(HeadingPropsSchema, PER_INSTANCE_PROPS))`, `ImageComponentDefaultsSchema
= Type.Partial(ImagePropsSchema)`, `TableComponentDefaultsSchema =
Type.Partial(Type.Omit(TablePropsSchema, ['rows']))`, and so on for
  statistic/section/columns/list. The `additionalProperties: true` at :90 sits on the OUTER object
  keyed by component name. docs/architecture/design-quality-10x.md §5B row "Component defaults"
  lists the new contents; today's column says "pptx table only; docx partial".
- **Task 7's pptx half has no way to address a type role, and contradicts the map's own tripwire.
  `fontCascade` reads the role spec only through `named.style = theme.styles?.[name]`, where
  `name` is the component's `style` prop, constrained to the seven STYLE_NAMES literals. There is
  no path by which a text box asks for `eyebrow` or `display`. So "project roles into fontCascade
  ... or `display` and `eyebrow` silently take the body font" describes a state that cannot be
  reached: either STYLE_NAMES grows — which the map's own tripwire correctly calls a document-
  schema change to every pptx text component's `style` prop union — or the roles are unreachable
  in pptx and the "paired deck and report match" goal fails on the deck side. The decisions list
  asks whether new palette roles become authorable component colours but never asks the same
  question for type roles, which is the bigger of the two.**
  <br>packages/core-pptx/src/ir/compiler.ts:690-699 (`namedStyle` casts the prop to `StyleName` and
  calls `pickStyle(theme, name)` = `theme.styles?.[name]`) and :708-740 (`fontCascade` consumes
  only `named.style`). packages/shared/src/schemas/slide-content/theme.ts:45-58 — `STYLE_NAMES` is
  seven literals and `StyleNameSchema` is built from it; shared-pptx/src/schemas/theme.ts:144-153
  builds the theme's `styles` object from the same list.

#### Other (9)

- **Task 6 understates the pptx side of palette roles by an order of magnitude. "Each format's
  existing resolver gains one fallback line" holds for docx (`getThemeColors` spread + the
  recursive chase at colorUtils.ts:47-53) but not for pptx: pptx dispatch is a fixed lookup table
  built from SEMANTIC_COLOR_NAMES and typed to the `colors` object's keys, so a role like `rule`
  or `positive` misses it entirely and falls into the "treat as literal hex" branch — a
  W_UNKNOWN_COLOR warning and the literal token string handed to pptxgenjs, which paints black.
  Worse, any palette role name that reaches a component prop or a TextStyle `fontColor` fails
  validation, because ColorValueSchema is a CLOSED union of hex plus the ten semantic names plus
  seven aliases. So pptx chrome/type-role recipes must be resolved to hex inside the compiler
  before they touch resolveColor, and `definedChartColorTokens` needs the same widening.**
  <br>packages/core-pptx/src/utils/color.ts:13-23 — `const SEMANTIC_TO_THEME_KEY: Record<string, keyof
PptxThemeConfig['colors']>` built from `SEMANTIC_COLOR_NAMES` plus seven aliases; :98-120
  resolveColor keys off it and :121-134 is the literal-hex fallthrough that warns and returns the
  bare string; :76-87 `definedChartColorTokens` indexes `colors[themeKey]` only.
  packages/shared/src/schemas/slide-content/theme.ts:36-43 — ColorValueSchema is
  `Type.Union([HexColorSchema, ...SEMANTIC_COLOR_NAMES literals, ...SEMANTIC_COLOR_ALIASES
literals])`.
- **Task 3's "MOVES ONE GOLDEN" is optimistic, because docx `fontWeight` is not a dropped field — it
  is realized by rewriting the font family to a synthesized variant name and recomputing
  bold/italic. The helper lives unexported inside the IR compiler. Reusing it naively in the style
  compiler flips `bold`/`italic` from "omitted when undefined" to explicit booleans on EVERY theme
  style (synthesizeFamilyName returns `{ bold: false, italic }` when weight is null), which
  rewrites styles.xml for every theme and therefore moves a large share of the corpus, not one
  case. The goldens are digests of every part in the package, so styles.xml counts. A correct fix
  has to synthesize only when `fontWeight` is explicitly present, and preserve the existing "omit
  when undefined" behaviour otherwise — worth stating in the task, since the naive version looks
  identical and is not.**
  <br>packages/core-docx/src/ir/compiler.ts:3146-3161 `applyFontWeightAlias` (not exported);
  packages/shared/src/fonts/synthesize.ts:61-95 — `if (weight == null) return { family, bold:
false, italic, ... }` and weight 700 → `{ family, bold: true }`. packages/core-
  docx/src/styles/themeToStyles.ts:272-273 today emits bold/italic only via `...(merged.bold !==
undefined && { bold: merged.bold })`. corpus-goldens.ts:1-19 documents the digest as "every part
  in the package — its position, its name and its exact uncompressed bytes".
- **The canvas key space in `typography.scale` and `spacing.canvas` is not a total function over
  what the two formats can actually produce, so a document outside the four listed canvases
  silently gets no scale and no grid. docx `page.size` admits A4, A3, LETTER, LEGAL and an
  arbitrary custom `{width,height}`; pptx slide dimensions are free numbers. The map's CANVASES is
  `['a4','letter','wide169','standard43']` — no A3, no LEGAL, no custom, no 16:10 — and it also
  silently diverges from the spec, which names three canvases (A4, 16:9 standard, 16:9 small) and
  no LETTER or 4:3. Either reconcile with §5B or state the derivation rule and its fallback,
  because "snapped to a 4pt baseline" is meaningless when the lookup misses.**
  <br>packages/shared-docx/src/schemas/theme.ts:48-72 — `size` is a union of 'A4' | 'A3' | 'LETTER' |
  'LEGAL' | `{width,height}`. docs/architecture/design-quality-10x.md §5B, Type system row: "one
  scale per canvas (A4, 16:9 standard, 16:9 small) snapped to a 4pt baseline".
- **Task 1's guard test as specified would not catch the class of bug it is written to prevent.
  `ensureThemeDefaults` does not only drop top-level keys — it also rebuilds `fonts` role by role
  and `page` key by key, so a new SUB-key survives the proposed top-level round trip while still
  being deleted. The test must walk the schema recursively (or the function must be a genuine deep
  merge), otherwise the pinned regression passes on the day the first nested layer is dropped.**
  <br>packages/core-docx/src/themes/defaults.ts:148-161 — `fonts: { heading:
{...DEFAULT_FONTS.heading, ...(theme.fonts?.heading || {})}, body: ..., mono: ..., light: ... }`
  enumerates exactly four roles, and `page: { ...DEFAULT_PAGE, ...(theme.page||{}), margins: {
...DEFAULT_PAGE.margins, ...(theme.page?.margins||{}) } }`. The map's stated test is "walks
  ThemeConfigSchema.properties and asserts every key survives a round trip" — top level only.
- **The proposed schema shape loses its Static types.
  `Type.Object(Object.fromEntries(TYPE_ROLES.map(r => [r, Type.Optional(TypeRoleSchema)])))` and
  the two `CANVASES.map` blocks all produce `properties` typed as `{[k: string]: TSchema}`, so
  `Static<>` collapses to an index signature: `theme.typography.roles.eybrow` type-checks, and a
  role removed from TYPE_ROLES breaks nothing. The repo already hit exactly this and had to paper
  over it with a cast. That undercuts the discipline the map itself praises two paragraphs earlier
  (createMinimalTheme typed as the schema's Static "precisely so a new REQUIRED field breaks the
  build"). Write the role and canvas objects as explicit literals, or add a compile-time agreement
  assertion.**
  <br>packages/shared-pptx/src/schemas/theme.ts:144-153 —
  `Type.Partial(Type.Object(Object.fromEntries(STYLE_NAMES.map((n) => [n, TextStyleSchema])) as
Record<string, typeof TextStyleSchema>))`; the cast is the tell. Contrast packages/shared-
  docx/src/schemas/theme.ts:536-538 and its comment at :522-533.
- **The map treats correcting the chart-palette comment as the only option, but the code is on the
  comment's side and the schema is the outlier — so widening the pptx colors pattern is an equally
  valid, arguably better fix that the map forecloses without stating it as a decision. pptx
  runtime already walks token references (`chainToHex`) and both doc comments assert it works;
  only the local hex pattern rejects it. Replacing the local pattern with `ColorValueSchema` is a
  strict superset of what validates today (bare hex still passes) and would make the docx and pptx
  palettes finally agree, which is the premise the whole `palette`-sibling design exists to work
  around.**
  <br>packages/core-pptx/src/utils/color.ts:48-65 `chainToHex` follows `"accent4": "primary"` to hex
  at runtime, and its own doc comment at :33-46 says the schema "lets a slot name another slot".
  packages/shared-pptx/src/schemas/theme.ts:76-79 is the local `^#?[0-9A-Fa-f]{6}$` used for every
  `colors` slot at :111-128, while `ColorValueSchema` is imported at :11 and used for
  `TextStyleSchema.fontColor` at :85.
- **The corpus arithmetic in the decisions list is wrong, which matters because it is the basis for
  a scope decision about #331. There are 273 goldens, not ~337. Only 31 corpus fixtures name a
  theme at all, so the default switch moves every case that names none — roughly 242 — while the
  26 that pin `minimal` are exactly the ones that would NOT move. Pinning the corpus to a frozen
  theme is therefore the opposite trade the question implies.**
  <br>packages/core-docx/src/**tests**/fixtures/corpus-goldens.ts — 273 keys. `grep -rho "theme:
'[a-z]*'" packages/core-docx/src/__tests__/fixtures/*.ts | sort | uniq -c` → 26 minimal, 3
  devportal, 2 vermilion.
- **Task 10's playground claim names the wrong guard, and the task itself collides with a stated
  non-goal. `colorTokens` reads `schema.properties.colors.properties` — a `palette` SIBLING block
  is invisible to it entirely, so the roles never appear in the editor and the Other-group test
  never fires. It is a silent omission, not a failing test, which means nothing in CI catches it.
  Separately, §10 of the spec lists "Playground changes" as an explicit non-goal for this
  programme, yet Task 5's file list includes theme-editor/model.ts.**
  <br>packages/jto/src/client/lib/theme-editor/model.ts:130-137 `schemaColors` reads
  `(schema).properties?.colors` and returns `Object.keys(colors?.properties ?? {})`; :143-173
  `colorTokens` groups only those keys. docs/architecture/design-quality-10x.md §10 Non-goals:
  "Playground changes."
- **Task 1 is a user-visible behaviour change on the `--theme-path` route, not only a latent-hazard
  fix, and the task does not say so. Once `fontRegistry` stops being deleted, a `--theme-path`
  theme that declares remote or file-sourced fonts starts actually resolving and embedding them —
  different bytes, different rendered output, possibly new FONT_UNRESOLVED or export-mode
  substitution warnings on themes that are silent today. Worth an explicit note and a check of any
  theme file used by the design-evals harness or the bundled gallery before this lands as "golden-
  safe, low risk".**
  <br>docx `--theme-path` .json goes jto-ops/src/format-adapter.ts:828-829 → core.loadThemeFromFile →
  core-docx/src/themes/json/index.ts:51-55 → themeParser.parse → parser.ts:104-107 applyDefaults →
  ensureThemeDefaults, which omits `fontRegistry` (defaults.ts:138-164) though it is legal at
  shared-docx/src/schemas/theme.ts:464. The existing passing test at core-
  docx/src/**tests**/document-font-registry.test.ts:112 does not cover this because `customThemes`
  bypasses ensureThemeDefaults entirely (core-docx/src/core/generationContext.ts:60-66).
