---
'@json-to-office/mcp-server': minor
---

`jto_critique record` refuses a ship verdict that says nothing about the integrity findings the inspection showed.

**Why.** In headless runs of two client reports and two decks, three runs each, every delivered deck carried rendered clip and spill findings; on one, a slide text was "cut off: about 95% of it". The agent saw them in `jto_preview` and in the `jto_critique inspect` evidence, recorded `ship` at level 5 with a rationale that never mentioned them, and `record` accepted it. A hard refusal is not the answer either: the rendered matcher can be wrong about a document, and in a blind review findings of the same kind held four reports the reviewer would have sent.

**What changes.** `inspect` keeps, on the run, the integrity findings it put in front of the model — category `integrity`, severity warning or worse: text clipped, spilled, overlapping or missing on the rendered page — and says in its `W_CRITIQUE_STOP` note which a ship verdict will have to answer for. `record` with `verdict: "ship"` is refused with `E_CRITIQUE_OPEN_FINDINGS`, listing each finding by code, page and pointer, while one is neither repaired nor accepted; nothing is filed and no round is spent. The new `accept` input takes the selectors a quality policy suppression takes — `code`, `ruleId` or `path` (with `pathMatch`) and a required `reason` — and is matched the same way. A ship filed over accepted findings keeps them on `record.accepted` with their reasons and answers with a `W_CRITIQUE_FINDINGS_ACCEPTED` warning; an acceptance that matched nothing is reported. `iterate` verdicts, retries of a filed verdict, and `jto_generate` are unchanged.
