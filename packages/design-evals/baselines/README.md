# Recorded baselines

Each file is one complete run set: every run, the aggregate, and the manifest
that says what produced it. They are committed because the programme's targets
are all deltas, and a delta needs a fixed end.

These historical sets predate the delivery-response and retry-accounting
guards. Their transcripts did not record tool responses, so successful artifact
delivery cannot be verified from the scorecards alone. Preserve the original
numbers; use fresh matched runs with the guards before making acceptance claims.

| File                                | Mode | Server | Model           | Runs | Judge |
| ----------------------------------- | ---- | ------ | --------------- | ---- | ----- |
| `2026-09-04-cold-server-2.0.0.json` | cold | 2.0.0  | claude-sonnet-5 | 40   | yes   |

## Reading one

`totals` are mechanical and `judge` is an opinion; they are separate objects on
purpose. `buildsClean` is a floor — the file built, nothing blocks generation,
no placeholder text survived — and is **not** the programme's shipping metric,
which is `judge.wouldShipRate`.

`totals.contaminated` must be 0. A run that reached a tool outside the
json-to-office server measured something other than the product, and a set with
any of them is not a baseline.

Every run carries `pageCountSource`. `rendered` means a converter counted the
pages; `structural` means the host could not render and the number is the
section or slide count instead. Do not average the two.

## Reproducing one

The manifest pins the git SHA, package versions, the exact model, the hashes of
the server instructions and of any skill, OS, Node, LibreOffice, poppler, the
host's font inventory by family, and the export-server endpoint class. When any
of those cannot be reproduced, report an incomparable baseline rather than a
misleading delta — that rule is in the spec (§5A) and it is the reason this
directory exists rather than a number in a README.

`2026-09-04-cold-server-2.0.0.json` carries two extra fields, both deliberate:
`rerunGitSha`, because one brief was re-run after `strictMcpConfig` landed and
the product was byte-identical across the two commits; and `converterNote`,
because the LibreOffice and poppler versions were backfilled after the run —
the probe read only env vars at the time, while every page count in the set
came from a real render.

## Comparing two of them

Compare **paired**, by brief id. The totals hide what the pairs show: cold and
assisted differ by 2.5 points on `judge.wouldShipRate`, and the pairs reveal
that is 6 briefs lost and 7 gained rather than a small consistent gain — with
only 2 of 40 shipping in both. A difference of proportions at n=40 has a
standard error near 9 points, so a gap smaller than that is not a result.

The assisted set carries `skillExcluded`: the skill ships a 4 MB template
library and scripts the agent had no tools to use, so that run measures the
ceiling of the skill's _guidance_, not of everything it ships.

## Re-judging a recorded set

`pnpm rejudge <run-dir>` judges the contact sheets a set already produced, without
re-authoring anything, and reports Cohen's kappa per rubric field. It exists
because nobody had measured how repeatable a verdict is, and every number in this
directory is built out of verdicts.

Measured once, on the 39 uncontaminated cold-baseline documents, judged again a
day later with the same rubric and the same model
(`2026-09-05-rejudge-cold-documents.json`):

| field       | agreement | kappa |
| ----------- | --------- | ----- |
| wouldShip   | 90%       | 0.73  |
| level       | 62% exact | 0.45  |
| genericness | 74% exact | 0.49  |

Read the kappas, not the percentages: on a corpus that is four-fifths
unshippable, always answering "no" scores 80% and knows nothing. By that measure
the binary verdict is the best-behaved field, not the worst — 0.73 is substantial
agreement — and `level` is the loose one, though only one document moved by more
than a single step.

**The problem is the direction, not the amount.** Four documents changed their
shipping verdict and all four went the same way, no to yes: the same corpus
scored 8 one day and 12 the next. Nothing moved in the other direction. So the
instrument does not wobble around a stable centre, it drifts, and the drift
between two sessions is four documents.

That is the number to hold against §1. The cold-to-assisted difference the spec
reports is **one** document, 8 against 9. It is a quarter of the judge's own
between-session drift, and the two sets were judged on different days. So the
paired analysis of cold versus assisted is not evidence of anything about the
skill, and it is not evidence against it either — it was measured with an
instrument whose zero moves by more than the effect.

The fix is cheap and does not need re-authoring: judge both sets in one pass,
from the sheets already on disk, so a comparison at least shares its zero.
Pairwise judging (`judgePair`, written but not yet wired into the scorecard) is
a relative comparison that still needs human calibration in #360.

## Comparing two sets pairwise

`pnpm pairwise <a-dir> <b-dir>` shows the judge both answers to one brief and
asks which is better. Comparing within a call reduces reliance on absolute
shipping thresholds, but does not establish immunity to judge drift or bias.

Every pair is judged twice, once in each order, and only a brief whose verdict
survives the swap is counted. That is not caution. The first attempt showed each
pair once and returned 25–13 for the assisted set; the judge had picked whichever
document it saw second in 68% of comparisons, and the per-brief hash meant to
balance the orders had put the assisted set second 23 times out of 38. Within the
orientation that disfavoured it, that set won 7 of 15. The run is kept as
`2026-09-05-pairwise-single-order-SUPERSEDED.json`.

Two-order result, cold against assisted
(`2026-09-05-pairwise-cold-vs-assisted.json`): **assisted 6, cold 0**, thirty
pairs where the orders disagreed, four not compared. The sign test on the six
order-consistent pairs gives p = 0.031, and eleven of the
twelve showings behind those six called the margin "clear".

The thirty disagreements remain unresolved; they are not ties and do not
establish the size of the underlying quality differences. The second-shown
win rate was 64%. Only six pairs supplied a stable direction, so this result
does not establish whole-corpus sendability or sensitivity to smaller future
improvements. Human calibration and further measurement remain in #360.
