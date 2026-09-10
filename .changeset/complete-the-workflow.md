---
'@json-to-office/shared': minor
'@json-to-office/mcp-server': minor
'@json-to-office/jto': minor
---

Complete the authoring workflow: an outline that decides a deck's slides, a critique loop that keeps its own count honestly, and three prompts into the loop (#421, #345, #348).

**An outline can now shape a deck, in three ways and no others.** A section whose bullets all read `Label: figure` — `Churn: 3.1%`, `Margin: 41 pts (+3.2)` — becomes rows of measurements, split evenly at the KPI block's own item ceiling so no slide carries a lone number. A section with more bullets than a slide's list holds becomes as many slides as it needs, in order, the later ones titled "(cont.)". A markdown table fills the evidence column of a two-column slide, with the columns whose body cells are all numbers right-aligned, and a `Source:` line fills the source of every slide the section became. Each is reported as `W_OUTLINE_TRANSFORMED`. Nothing is invented, nothing is reordered, and every slide is a structural clone of one the variant already drew — so the block definitions, their dependencies and the fill map still describe the document that exists. Where the variant draws no slide of the shape a section asks for, the section is filled as the variant's own slide and `W_OUTLINE_UNMAPPED` names the shape that was wanted. The outline parser now reads bullets, tables and wrapped list items in both formats; a bullet is another line of body in a document.

**`jto_critique` makes the review step part of the product.** `inspect` renders the exact workspace revision and returns a contact sheet of the whole document, full-resolution pages where the rendered pass found something, that pass's findings, the rubric as data and a run id; `record` files the verdict formed against that run. The server does not judge — the model in the conversation does — but it owns the count, and it owns it strictly: only `record` creates a round, re-sending the same `runId` returns the round already filed (`W_CRITIQUE_DUPLICATE`), and a verdict about a revision the workspace has since moved past is refused with `E_STALE_REVISION` rather than filed against a document nobody saw. Three recorded `iterate` rounds is the limit and the third recommends stopping. None of it gates `jto_generate`.

**The rubric is one table.** It moves beside the blueprints in `@json-to-office/shared`, so the evaluation judge's prompt, `jto_critique`'s rubric and the generated design guide are all rendered from the same five levels and the same shipping question, with a drift test that fails if the guide stops stating them.

**Three prompts** — `design-brief`, `report-from-notes`, `deck-from-outline` — give a prompts-capable client an entry point that lands on `jto_scaffold` and walks fill → validate → look → judge → ship. They name the blueprints and themes the cores actually ship rather than a copy of them, and they restate no design rule: that stays in `jto://guide/design/<format>` and the diagnostics.
