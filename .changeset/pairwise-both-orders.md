---
'@json-to-office/mcp-server': patch
---

A pairwise comparison is only counted when it survives swapping the two documents around.

The first pairwise run returned 25 against 13 in the assisted set's favour, p = 0.073, and it was mostly seating. The check built into it for exactly this reason says the judge picked whichever document it saw **second** in 68% of comparisons, and the per-brief hash meant to balance the orders happened to put the assisted set second 23 times out of 38. Within the orientation that disfavoured it, the same set won 7 of 15 — a coin.

So every pair is now judged twice, once in each order, and a brief counts only when both showings name the same winner. A document that wins from the second slot and loses from the first has not won; it is recorded as `inconsistent`, which is a pair the judge could not rank rather than a pair anyone lost. The scorecard prints the second-shown win rate before it prints any claim about the documents, because that number is the instrument and it belongs above the result.

Two calls per brief instead of one, still no re-authoring. `--single-order` restores the old behaviour for a smoke run and says in its own documentation not to use it for a result. The superseded run is kept in `baselines/` under its own name, as the evidence for why the design changed.
