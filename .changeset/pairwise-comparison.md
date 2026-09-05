---
'@json-to-office/mcp-server': patch
---

Comparisons between two run sets no longer go through the judge's zero.

Absolute verdicts drift, and today's measurement showed the drift has a direction: the same 39 documents scored 8 shippable one day and 12 the next, with every change in the same direction and none coming back. The cold-to-assisted difference the spec reports is one document. An effect a quarter the size of the instrument's zero-shift is not an effect, and re-judging each side again does not fix it — it only makes the two zeroes recent instead of distant.

`pnpm pairwise <a-dir> <b-dir>` shows the judge both answers to the same brief and asks which is better. There is no zero to move: a lenient session, a fuller context, a different mood in the rubric moves both documents together and neither side of the comparison. Both sets already have contact sheets on disk, so the default two-order comparison costs two calls per brief and no authoring.

Each pair is shown in both orders; only verdicts that agree after the swap contribute to the sign test. A seeded single-order mode is available for smoke checks, but produces no comparative conclusion. The winner is translated back out of the shown order and the orientation is recorded, so a reader can check the un-flipping.

The result is reported with an exact two-sided sign test, because the paired shape this programme keeps producing — nine against four — reads as convincing and is not.
