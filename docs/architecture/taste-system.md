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
