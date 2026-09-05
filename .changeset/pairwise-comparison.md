---
'@json-to-office/mcp-server': patch
---

Comparisons between two run sets no longer go through the judge's zero.

Absolute verdicts drift, and today's measurement showed the drift has a direction: the same 39 documents scored 8 shippable one day and 12 the next, with every change in the same direction and none coming back. The cold-to-assisted difference the spec reports is one document. An effect a quarter the size of the instrument's zero-shift is not an effect, and re-judging each side again does not fix it — it only makes the two zeroes recent instead of distant.

`pnpm pairwise <a-dir> <b-dir>` shows the judge both answers to the same brief and asks which is better. There is no zero to move: a lenient session, a fuller context, a different mood in the rubric moves both documents together and neither side of the comparison. Both sets already have contact sheets on disk, so it costs one call per brief and no authoring.

Which side is shown first varies by brief and is derived from the brief id, so the order is stable across re-runs but not constant across the corpus — a judge shown the new work second on all forty briefs has been told where to find it. The winner is translated back out of the shown order and the orientation is recorded, so a reader can check the un-flipping.

The result is reported with an exact two-sided sign test, because the paired shape this programme keeps producing — nine against four — reads as convincing and is not.
