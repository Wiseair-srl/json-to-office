# Recorded baselines

Each file is one complete run set: every run, the aggregate, and the manifest
that says what produced it. They are committed because the programme's targets
are all deltas, and a delta needs a fixed end.

These historical sets predate the delivery-response and retry-accounting
guards. Their transcripts did not record tool responses, so successful artifact
delivery cannot be verified from the scorecards alone. Preserve the original
numbers; use fresh matched runs with the guards before making acceptance claims.

| File                                                  | Mode | Server | Model           | Runs                                       | Judge               |
| ----------------------------------------------------- | ---- | ------ | --------------- | ------------------------------------------ | ------------------- |
| `2026-09-04-cold-server-2.0.0.json`                   | cold | 2.0.0  | claude-sonnet-5 | 40                                         | yes                 |
| `2026-09-07-checkpoint-before-cold-server-4.4.0.json` | cold | 4.4.0  | claude-sonnet-5 | 24 (set `client-report-checkpoint`, 8 × 3) | yes (claude-opus-5) |
| `2026-09-08-checkpoint-after-cold-server-4.4.2.json`  | cold | 4.4.2  | claude-sonnet-5 | 24 (set `client-report-checkpoint`, 8 × 3) | yes (claude-opus-5) |
| `2026-09-08-rejudge-checkpoint-before.json`           | —    | —      | —               | 24 rejudged, same session as the next row  | claude-opus-5       |
| `2026-09-08-rejudge-checkpoint-after.json`            | —    | —      | —               | 24 rejudged, same session as the row above | claude-opus-5       |

## The client-report checkpoint "before" set

`2026-09-07-checkpoint-before-cold-server-4.4.0.json` is #360's fixed-revision
record of the current product on the `client-report-checkpoint` brief set,
before the #362 integration work. It carries the delivery and retry guards the
older sets lack: every run's `jto_generate` returned `ok` with an artifact, 0
failed, 0 retries, 0 contaminated, usage complete. A local Highcharts export
server (`endpointClass: local`) was part of the render environment; the
"after" run for #362 must keep it.

What it measures is not a pre-block product. Cold at 4.4.0, the agent calls
`jto_scaffold` on its own, so every run went through blueprint → fill map →
patch → generate with the consulting theme, the client-report profile and the
report blocks. The delta to the #362 run is the integration and repair work
still owed, not the existence of blocks.

Judged in one pass by claude-opus-5: 3/24 would ship (13%), 13/24 at level ≥4,
median level 4, median genericness 2. Two product defects recur in the
rationales and are not caught by any static rule (`qualityByCode` is empty and
the harness recorded no rendered findings): the `highcharts.com` credit left in
the plot area (13 rationales) and empty or near-empty pages under a running head
(10 rationales; `cr-workforce-planning` runs 2 and 3 fell to level 1 on it).

Both were fixed after this set was recorded, and the second changed the metric
itself: the rendered pass now counts a page whose only words are its running
head and footer as empty (`W_QUALITY_RENDERED_EMPTY_PAGE`, `kind: chrome-only`),
and the client-report profile reports it at `warning`. The 0 rendered findings
here were recorded under the older rule, so a non-zero count in the "after" set
is partly the rule seeing more, not only the documents changing.

## The client-report checkpoint "after" set

`2026-09-08-checkpoint-after-cold-server-4.4.2.json` repeats the before set under
matched conditions on main at `f0dd20e` (jto-ops and core-docx 4.4.2, mcp-server
4.4.0): same eight briefs, three passes, cold, claude-sonnet-5, judged once by
claude-opus-5, local Highcharts export server, delivery and retry guards on.
24/24 delivered, 0 failed, 0 retries, 0 contaminated. The revision carries the
two fixes the before set asked for: the chart credit is off, and the rendered
pass sees a page that holds only its running head and footer.

Read the headline with the judge drift beside it, or it reads backwards:

|                            | before, judged 09-07 | after, judged 09-08 | before, rejudged 09-08 | after, rejudged 09-08 |
| -------------------------- | -------------------- | ------------------- | ---------------------- | --------------------- |
| would ship                 | 3/24                 | 2/24                | 2/24                   | 3/24                  |
| level ≥4                   | 13/24                | 6/24                | 9/24                   | 5/24                  |
| median level / genericness | 4 / 2                | 3 / 3               | 3 / 3                  | 3 / 2                 |

The two rejudge files were produced in one sitting, before set first, so they
share a zero. On that shared zero the sets are level for level equal in sum (76
against 76 over 24 runs) and the whole gain sits in one brief:
`cr-workforce-planning` goes 4, 1, 1 → 4 (ship), 4, 3. Those were the two runs
the before set sank on empty pages under a running head. Every other brief moves
by a step or nothing, in both directions. The before set's own two judgements
(09-07 against 09-08) agree on shipping with kappa 0.33 and on level with 0.52;
the after set's with 0.33 and 0.25. That drift is larger than any delta here
except workforce's, which is why this set is a checkpoint and not acceptance.

What the judge now says, in 24 rationales: the `highcharts.com` credit is gone
(13 → 0 mentions); under-filled section pages — one heading and a paragraph,
two-thirds of the sheet blank — in 18 of 24; the argument carried in prose
where a table or chart was owed in 19 of 24. Both are the product's next
lever, not the agent's: the blueprint gives every section its own page under
the running head, and nothing measures page fill.

Two runs carry a rendered integrity defect. Both are matcher false positives,
recorded here so they are not counted as document defects:
`cr-post-merger-integration#2` has a plain table whose wrapped cells pdftotext
joined across columns on one row (clip at 47%, three cells "missing"; the sheet
shows them complete), and `cr-workforce-planning#3` has a numeric cell `1.05`
that lost its occurrence to `£1.05m` in the body. Column-aware line splitting
in the rendered pass is the fix (#344).

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
