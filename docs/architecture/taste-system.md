# Taste system

Contributor design and acceptance reference for first-class document quality.

## North star

A maximum-quality document communicates its purpose to its intended audience with
minimum cognitive friction. Every choice is intentional, coherent with its design
profile, accessible, and robust in the target renderers.

Quality is contextual. Dense copy can be appropriate in a legal appendix and wrong
on an executive slide. An overlap can be deliberate composition or an accidental
collision. The system therefore never treats one universal aesthetic as truth.

## Quality model

The system evaluates five ordered dimensions. A higher level never compensates for
a failure below it.

| Level | Dimension                    | Reference bar                                                            | System responsibility                |
| ----- | ---------------------------- | ------------------------------------------------------------------------ | ------------------------------------ |
| 1     | Integrity                    | Nothing clipped, broken, lost, or accidentally moved                     | guarantee when deterministic         |
| 2     | Legibility and accessibility | Content can be read and navigated by the intended audience               | guarantee where measurable           |
| 3     | Visual coherence             | Hierarchy, grid, rhythm, typography, colour, and repeated patterns agree | guarantee against a declared profile |
| 4     | Communicative effectiveness  | Density, structure, charts, and tables fit purpose and medium            | evaluate and advise                  |
| 5     | Craft and distinctiveness    | Composition is refined, intentional, and not generically template-like   | rendered or human/vision review      |

The architecture permits guarantees at levels 1–3 when a rule has the required
facts. A guarantee applies only to published rule coverage; it is not a claim that
every possible integrity or coherence defect is implemented. Level 4 is evaluated
without simulated certainty. Level 5 is optional and never a deterministic gate.

`professional` means the authored case is clean for covered levels 1–3 under its
declared profile. `excellent` also meets the level-4 reference and is suitable for
rendered level-5 review. Static rules alone must not claim that an artefact is
excellent.

The quality scope includes content design: hierarchy, density, title function,
chart choice, and the relationship between content and its container. It excludes
factual truth and prose quality.

## Evidence, not simulated certainty

Every finding states how it knows:

| Certainty       | Evidence                                        | Example                                              |
| --------------- | ----------------------------------------------- | ---------------------------------------------------- |
| `deterministic` | Exact resolved structure or geometry            | table exceeds usable section width                   |
| `measured`      | Exact measurement interpreted through a profile | contrast 3.1:1 below a 4.5 target                    |
| `estimated`     | Conservative deterministic heuristic            | estimated text height exceeds its box                |
| `rendered`      | Inspection of a rendered artefact               | widow, clipped chart label, font substitution reflow |
| `evaluative`    | Contextual vision or human judgement            | weak balance or insufficient distinctiveness         |

Severity and certainty are independent. A severe estimated finding remains an
estimate; a deterministic observation can still be informational.

## Design profile versus run policy

A design profile defines what good means for a document class. It may be referenced
by a theme, but it is not a theme: tokens describe available visual values, while a
profile describes intended use.

Examples include `executive-deck`, `technical-report`, and `legal-appendix`. Profiles
may constrain typography roles, density, safe areas, spacing rhythm, accessibility,
and renderer targets.

A run policy defines enforcement for one invocation: enabled rule packs, severity
overrides, suppressions, diagnostic budgets, and the gate threshold. Rules produce
findings; policy decides whether a finding blocks CI. Taste remains non-blocking by
default.

The portability baseline covers supported Microsoft Office, LibreOffice, and PDF
preview paths. A profile may additionally target a specific renderer for maximum
fidelity.

## Target pipeline

```text
authored JSON
  -> parse and structural validation
  -> expansion and effective-value resolution
  -> PreparedDocument { model, provenance, theme, renderer, warnings }
       -> renderer -> bytes
       -> fact extractors -> facts
            -> quality engine + design profile + run policy
                 -> unified diagnostics
  -> optional rendered artefact audit -> unified diagnostics
```

Official pipelines prepare once per request. Renderer and quality analysis consume
the same opaque prepared model through `FormatAdapter.prepareDocument`; neither
independently reconstructs effective defaults. Third-party/plugin adapters without
that optional capability may prepare inside `analyzeQuality`. The model remains
format-specific because DOCX flow and PPTX geometry are genuinely different.

Provenance is created during transformation. Every resolved or synthetic node knows
the authored RFC 6901 JSON Pointer that caused it, plus related pointers when one
result comes from several inputs. Rules never reverse-engineer authored indexes
from a transformed tree.

## Package boundaries

`@json-to-office/quality` owns only format-agnostic contracts and orchestration:

- diagnostics, evidence, fixes, and stable rule metadata;
- rule, fact, profile, policy, and prepared-document contracts;
- rule registry, policy resolution, filtering, ordering, and gating;
- common rule helpers with no DOCX/PPTX imports.

Each core owns its format semantics:

- preparation and provenance;
- format-specific facts;
- built-in DOCX or PPTX rule packs;
- conversion from its prepared model to its renderer IR.

Host packages compose profiles and rules, then expose one analysis result through
CLI, MCP, HTTP, and the playground. Optional rendered analysis remains outside the
dependency-light quality package.

The dependency direction is one way:

```text
quality
  <- core-docx / core-pptx
  <- jto-ops
  <- CLI / MCP / HTTP / playground
```

`quality` must not import either core, a renderer, filesystem code, or UI code.

## Core contracts

Illustrative contracts; exact generic names can change without changing ownership.

```ts
interface PreparedDocument<TModel, TFact> {
  format: 'docx' | 'pptx';
  model: TModel;
  facts: readonly TFact[];
  provenance: ProvenanceMap;
  renderer?: string;
}

interface QualityRule<TFact> {
  readonly id: string;
  readonly category:
    | 'integrity'
    | 'accessibility'
    | 'legibility'
    | 'hierarchy'
    | 'composition'
    | 'consistency'
    | 'information-design'
    | 'brand';
  evaluate(context: QualityContext<TFact>): readonly QualityRuleFinding[];
}
```

The unified diagnostic envelope carries `source`, stable `code`, category, severity,
certainty, primary and related paths, structured evidence, suggestion, and optional
RFC 6902 fixes. Surface adapters present this envelope; they do not flatten it into
format-specific warning types.

## Acceptance corpus

The architecture is accepted against an executable reference corpus, not only unit
tests for individual rules.

Each document class contains:

- `poor`, `professional`, and `excellent` examples over comparable content;
- declared design profile and renderer target;
- expected findings with category, certainty, and rationale;
- warning-clean `professional` and `excellent` authored examples;
- stable structural digests for all outputs;
- golden rendered pages/slides for selected `excellent` cases;
- mutations proving each guaranteed rule catches a real degradation;
- cross-renderer cases separating portability defects from renderer-specific craft.

Initial profiles: `executive-presentation`, `technical-presentation`,
`executive-report`, `technical-report`, and `legal-appendix`. Their 15 executable
cases and authored-structure digests live in
`packages/jto-ops/src/quality-reference-corpus.ts`; the core renderer corpora retain
the package-part goldens.

False positives are regressions. A suppression can document a deliberate exception,
but stock examples may not become clean merely by globally disabling a rule.

The same false-positive bar applies to real documents through the calibration
suite (`packages/jto-ops/src/quality-calibration.test.ts`), which holds the
reference stock templates (`STOCK_REFERENCE_TEMPLATES`) warning-clean under the
default profile. Only that curated set is reference quality; the remaining
playground templates are starting points and must not constrain thresholds.

## Rendered ground truth

The corpus pins false positives; it cannot see false negatives — a rule that never
fires passes every clean-template check. The ground-truth harness
(`packages/jto-ops/src/quality-ground-truth.harness.test.ts`, run with
`pnpm --filter @json-to-office/jto-ops test:ground-truth`; needs LibreOffice and
poppler) measures the other direction: it renders mutated stock templates (every
template, reference or not — mutation only borrows realistic geometry) through
soffice, reads exact word geometry back out of the intermediate PDF with
`pdftotext -bbox` (`extractPdfTextGeometry` in jto-ops), and scores every estimated
verdict against what the renderer actually laid out. Bottom-edge scoring admits
only top-aligned, unrotated text; other alignments and rotations are reported as
unsupported until the harness models their top edge and coordinate transform. A
second suite adjudicates every comparable finding the rules raise on the authored
templates the same way.

Estimator thresholds are tuned against these measurements, not by feel — the
`characterWidthFactor` default records its measured operating point in
`core-pptx/src/quality/rules.ts`. The harness also marks the model's ceiling:
static character-count estimates top out near half of the >1-line-height spills
under the zero-false-warning constraint, and the remainder is reachable only as
`rendered`-certainty findings built on the same PDF geometry.

## Design evals: measuring the whole loop

The ground-truth harness measures one estimator against one renderer. It cannot
say whether an agent, handed a brief and this server, produces something worth
sending. `packages/design-evals` measures that, and it is the instrument every
phase of the design-quality programme is accepted on.

```bash
pnpm evals -- --briefs cr-market-entry-nordics,cd-quarterly-business-review
pnpm evals -- --model claude-opus-5 --out ./evals-out/baseline
pnpm evals -- --sealed-corpus /path/to/acceptance/briefs   # final acceptance only
```

It lives in its own private package rather than inside `jto-ops`, where the
programme spec first placed it: the harness has to drive the MCP server, and
`mcp-server` already depends on `jto-ops`, so the two could only be one package
by way of a cycle. Keeping it separate also keeps the Claude Agent SDK out of a
library other people install.

One command takes briefs from the committed 40-brief development corpus
(`packages/design-evals/briefs`, 24 docx and 16 pptx across the three v1
archetypes, with format, archetype, language and data-density metadata), drives
a headless Claude agent against the real MCP server over stdio, keeps every run
artifact, and writes one `scorecard.json`. `--briefs` runs a subset;
`--sealed-corpus` points at an acceptance set supplied from outside the repo.

**Cold by default.** The agent gets the server's own instructions and the
json-to-office tools, and nothing else — no skill, no project settings, no file
or shell access. That is the measurement the targets are stated against: what
the product alone gets you. `--skill <path>` makes the run assisted, and the
manifest records which it was and hashes what the skill said.

**The harness measures; the agent does not report.** Every number in a scorecard
is recomputed from the document the agent last handed to `jto_generate` — read
passively out of the tool call, never out of a summary. An author that declares
itself finished with a broken document is precisely what the scorecard exists to
catch, so its own account of its work is evidence of nothing.

**Three numbers mean exactly what they say, and the names are load-bearing.**
`buildsClean` is a mechanical floor — the file built, nothing blocks
generation, no placeholder text survived — and is deliberately NOT called
shippable, because whether a document is worth sending is the judge's question
and reaches the scorecard as `judge.wouldShipRate`. `iterations` counts
edit-and-recheck rounds after the first draft, which is the spec's metric with
its target of 2, not the agent's turn count, which is an order of magnitude
larger and lives beside it as `turns`. `pages` is measured by rendering the
document where LibreOffice and poppler are present, and every run records
whether its count was `rendered` or `structural`, so a corpus measured across
two hosts can never average the two and say nothing.

**Failures stay in the denominator.** A run that errored, ran out of turns or
ended without generating anything counts as a run and as not shippable. A
denominator that shrinks when the agent gives up is a denominator that improves
by giving up. Every failure is named in the scorecard's `failures` array.

Each scorecard carries a complete reproducibility manifest — git SHA and whether
the tree was dirty, package and SDK versions, the exact model id and parameters,
hashes of the server instructions and of any skill, OS, Node, LibreOffice and
poppler versions, the host's font inventory by family, the export-server
endpoint class (`local`, `private`, `hosted`, `none`) and the retry budget. A
field that could not be read is recorded as `unavailable` rather than dropped: a
manifest with a hole is still a manifest, while one that quietly shrank is a
comparison waiting to mislead.

### The judge

`--judge <model>` adds a vision pass: the produced document is rendered through
the same preview pipeline `jto_preview` uses, composed into one contact sheet,
and scored against the five-level rubric — rendered, never from the JSON,
because every question above level 3 is about what a reader sees. It answers
the shipping question ("would you send this to a client, unchanged, with your
name on it?") and rates genericness separately, because moving design decisions
into a house theme risks making every document look the same, and a scorecard
should be able to see that happening rather than celebrating it as consistency.

The rubric prompt is generated from the same table this document defines, so
the judge and the rules cannot drift into measuring different things. The
verdict is `evaluative` and never a gate; it sits in its own object on the
scorecard so that a taste change and a defect change stay distinguishable. A
failed run is judged as unshippable rather than left out — otherwise a phase
improves its rate by producing fewer documents.

A judge is worth its agreement with the person the documents are for.
`buildCalibrationSheet` assembles development-corpus pairs into a rating sheet
with the human column blank and the judge's own answer recorded beside it;
`calibrationReport` returns raw agreement, Cohen's kappa and a percentile
bootstrap interval from a seeded PRNG, so "run it again" is not an argument
against the number. Unrated pairs are dropped and counted, never averaged
towards whichever answer is convenient. Below 0.8 agreement the human answer is
authoritative and the judge's contribution is reported but not relied on.

The headless runner is a proxy for the real surface, which is Claude Desktop.
`agreement()` compares paired ship/no-ship verdicts and reports raw agreement
alongside Cohen's kappa, because on a corpus where most runs fail both ways raw
agreement is what chance would have produced anyway.

## Non-goals

- A single opaque quality score.
- Factual verification or prose rewriting.
- One hard-coded aesthetic for every document class.
- Vision-model output presented as deterministic truth.
- Rendering inside the dependency-light static analysis path.
- A universal DOCX/PPTX intermediate representation.

## Growth checkpoints

Revisit these choices when a third format lands, rule plugins need isolation, rendered
analysis becomes a service, or profiles require versioned distribution. Until then,
keep prepared models internal, rules pure, diagnostics serialisable, and the package
free of renderer dependencies.
