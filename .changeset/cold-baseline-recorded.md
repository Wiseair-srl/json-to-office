---
'@json-to-office/mcp-server': patch
---

The cold baseline is measured and recorded. Spec §1's "today" column was a hypothesis; it now carries numbers.

Forty briefs, server 2.0.0, `claude-sonnet-5`, judged on renders, no failures and nothing contaminated. Two of the five estimates were pessimistic by roughly 4x — a quarter of cold outputs already reach rubric level 4 and a fifth would be sent to a client unchanged, against estimates of ~5% for both. The rubric median of 3 says where the wall actually is: visual coherence is met, communicative effectiveness is not.

The integrity row is recorded as **not yet measurable** rather than as 0%. The static rules found no integrity defect in any of the forty documents, but the row asks about _rendered_ defects, the rendered pass does not exist yet, and the spec's own diagnosis puts the static estimator's ceiling at about half of real spills. A 0% there would mean "nothing looked", and would read as a target already beaten.

The two numbers that carry the most signal are not in the table. Median genericness is 3 of 4 — the documents build, do not break, and read as interchangeable, which is the programme's thesis measured instead of asserted. And 611 `W_QUALITY_OFF_PALETTE` findings across forty documents, about fifteen apiece: the cold agent writes hex by hand and ignores the theme palette entirely, which is the direct case for Phase 1.

`median 1 iteration` beats its target of 2 for the wrong reason. Split by archetype, `client-report` iterates a median of zero times: the docx runs open no workspace and one never previews at all. They do not iterate because they do not look.

Baselines live in `packages/design-evals/baselines/` with a README on how to read and reproduce one. Also fixed here: the manifest probed LibreOffice and poppler only from env vars, so the first baseline recorded both as `unavailable` while every page count in it came from a real render — `pdftoppm` reports its version on stderr, which the old probe discarded.
