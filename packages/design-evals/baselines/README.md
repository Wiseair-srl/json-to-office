# Recorded baselines

Each file is one complete run set: every run, the aggregate, and the manifest
that says what produced it. They are committed because the programme's targets
are all deltas, and a delta needs a fixed end.

These historical sets predate the delivery-response and retry-accounting
guards. Their transcripts did not record tool responses, so successful artifact
delivery cannot be verified from the scorecards alone. Preserve the original
numbers; use fresh matched runs with the guards before making acceptance claims.

| File                                                      | Mode | Server                                 | Model           | Runs                                          | Judge               |
| --------------------------------------------------------- | ---- | -------------------------------------- | --------------- | --------------------------------------------- | ------------------- |
| `2026-09-04-cold-server-2.0.0.json`                       | cold | 2.0.0                                  | claude-sonnet-5 | 40                                            | yes                 |
| `2026-09-07-checkpoint-before-cold-server-4.4.0.json`     | cold | 4.4.0                                  | claude-sonnet-5 | 24 (set `client-report-checkpoint`, 8 × 3)    | yes (claude-opus-5) |
| `2026-09-08-checkpoint-after-cold-server-4.4.2.json`      | cold | 4.4.2                                  | claude-sonnet-5 | 24 (set `client-report-checkpoint`, 8 × 3)    | yes (claude-opus-5) |
| `2026-09-08-rejudge-checkpoint-before.json`               | —    | —                                      | —               | 24 rejudged, same session as the next row     | claude-opus-5       |
| `2026-09-08-rejudge-checkpoint-after.json`                | —    | —                                      | —               | 24 rejudged, same session as the row above    | claude-opus-5       |
| `2026-09-08-human-checkpoint-verdicts.json`               | —    | —                                      | —               | 48 absolute + 24 pairwise, Paolo, blind       | human               |
| `2026-09-08-checkpoint-after-fill-cold-server-4.4.0.json` | cold | 4.4.0 (jto-ops 4.4.2 + page-fill rule) | claude-sonnet-5 | 24 (set `client-report-checkpoint`, 8 × 3)    | yes (claude-opus-5) |
| `2026-09-08-rejudge-checkpoint-before-2.json`             | —    | —                                      | —               | 24 rejudged, same session as the next row     | claude-opus-5       |
| `2026-09-08-rejudge-checkpoint-after-fill.json`           | —    | —                                      | —               | 24 rejudged, same session as the row above    | claude-opus-5       |
| `2026-09-08-page-fill-measure.json`                       | —    | —                                      | —               | page fill of every delivered document, 3 sets | rendered pass       |
| `2026-09-08-checkpoint-after-flow-cold-server-4.4.4.json` | cold | 4.4.4 + sections flow (PR #402 build)  | claude-sonnet-5 | 24 (set `client-report-checkpoint`, 8 × 3)    | yes (claude-opus-5) |
| `2026-09-08-rejudge-checkpoint-before-3.json`             | —    | —                                      | —               | 24 rejudged, same session as the next row     | claude-opus-5       |
| `2026-09-08-rejudge-checkpoint-after-flow.json`           | —    | —                                      | —               | 24 rejudged, same session as the row above    | claude-opus-5       |

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
in the rendered pass is the fix (#344). The same post-merger run also records
one `W_QUALITY_RENDERED_FONT_SUBSTITUTED`, at `info`: the consulting theme's
body face is Calibri, which this host does not have, so LibreOffice previewed
it in Carlito. That is a fact about the render host, declared as such by the
finding (`declared: false`), not a defect in the document.

## Human calibration on the checkpoint sets

`2026-09-08-human-checkpoint-verdicts.json` is Paolo's blind review of the same
48 contact sheets the judge saw, in a guided page: one sheet at a time,
shuffled across both sets, "would you send this to the client unchanged", then
the 24 before/after pairs of the same brief and pass with sides randomised,
"which would you rather send". This is the calibration #360 asked for.

|                         | before | after |
| ----------------------- | ------ | ----- |
| Paolo would send        | 10/24  | 8/24  |
| judge, original session | 3/24   | 2/24  |
| judge, 09-08 session    | 2/24   | 3/24  |

Pairwise, Paolo prefers the before document 12 times, the after document 6,
and calls 6 ties; the rejudge levels imply 6, 3 and 15. Both readers agree the
after set is not better. Every one of Paolo's 30 rejections names the same
reason, empty or half-blank pages — the defect `rendered/page-underfilled`
now reports.

**The judge's ship flag is not Paolo's.** Agreement on shipping is 69% with
the original session (kappa 0.22) and 60% with the rejudge (kappa 0.01): the
judge answers "ship" for 5 of 48 where Paolo answers it for 18, and the two
sets of five overlap Paolo's only by 4 and 2. The judge's _level_ tracks him
better: Paolo sends 10 of the 14 documents the rejudge put at level 4 and 7 of
the 30 at level 3. So for now read "excellent" (level ≥ 4) as the judge's
sendability estimate and treat its `wouldShip` as advisory, as #360 item 5
already says; recalibrating the ship question in the rubric is the follow-up.

## The checkpoint set with the page-fill rule

`2026-09-08-checkpoint-after-fill-cold-server-4.4.0.json` repeats the set once
more on main after PR #398 (`rendered/page-underfilled` at `warning` under
`client-report`). The name carries the `mcp-server` package version the manifest
records, 4.4.0; the rule lives in jto-ops and core-docx at 4.4.2, and the server
was built from `a9e4e22`, with the working tree during the run carrying only
harness commits on top. (The earlier `…-after-cold-server-4.4.2.json` was named
after the jto-ops version; its manifest also records mcp-server 4.4.0.) Same eight briefs, three passes, cold,
claude-sonnet-5, judged by claude-opus-5, local Highcharts export server
checked healthy before and every three minutes during the run. 24/24
delivered, 0 failed, 0 export-server errors, 16 of 24 documents carry a chart.

A first attempt at this run is not recorded as a baseline: the export server's
worker pool had died beforehand (`pool.all` 0, every export answered 400),
15 of 24 transcripts met the error and all 24 delivered documents lost their
charts; the judge shipped 0 and the agent spent a median of 5 iterations. The
harness now records such runs as `environmentFailures` and warns above the
judge line; the health check is part of the run recipe.

Judged in one sitting against the before sheets
(`2026-09-08-rejudge-checkpoint-before-2.json` and `…-after-fill.json`):

| today's judge           | before  | after-fill |
| ----------------------- | ------- | ---------- |
| would ship              | 4/24    | 5/24       |
| level ≥4                | 6/24    | 11/24      |
| level sum over 24       | 73      | 83         |
| `cr-workforce-planning` | 3, 1, 1 | 4, 4, 3    |

Two rejudges of the unchanged before set a day apart sum to 76 and 73, so
+10 is above the session noise seen so far, and it comes from several briefs,
not one. Measured directly rather than through the judge
(`2026-09-08-page-fill-measure.json`), under-filled pages go from 39% of all
pages in both earlier sets to 28%, and documents with any such page from 21
to 17 of 24; the median page count falls from 5.5 to 5.

What the rule cannot do: the delivered documents still carry 41 under-filled
pages, and 17 of 24 rationales still name them. The agent cannot merge a short
section into its neighbour, because the running head's section tracker gives
every section its own page, so it either pads (seen in the confounded run:
24% → 41% → 49% by adding prose) or ships with the warning. The advice now
says merge, not pad. The remaining lever is structural: take the tracker out
of the running head, or let sections continue on the page; a manual test on
one document (later sections `pageBreak: false`) went from 7 pages to 5 with
no under-filled page, at the cost of the per-section header text.

## The checkpoint set with sections flowing

`2026-09-08-checkpoint-after-flow-cold-server-4.4.4.json` repeats the set on
the PR #402 build (`4b74854`, a development build, not a release): a section
that inherits the running head no longer inherits its page break, and the
running head carries the document title alone. Same eight briefs, three
passes, cold, claude-sonnet-5, judged by claude-opus-5, export server verified
healthy before and every three minutes during the run. 24/24 delivered, 0
failed, 0 export errors, 13 of 24 documents carry a chart, median 2 iterations.

Judged in one sitting against the before sheets
(`2026-09-08-rejudge-checkpoint-before-3.json` and `…-after-flow.json`):

| today's judge                         | before | after-flow |
| ------------------------------------- | ------ | ---------- |
| would ship                            | 0/24   | 3/24       |
| level ≥4                              | 3/24   | 12/24      |
| median level                          | 3      | 3.5        |
| level sum over 24                     | 70     | 84         |
| under-filled pages, measured directly | 39%    | 0%         |
| pages, all 24 documents               | 148    | 104        |

The before set's three sittings sum to 76, 73 and 70 — the judge has grown
harsher through the day — and on this shared zero the flowing set is +14,
the largest move of the checkpoint, spread over six of the eight briefs
(`cr-workforce-planning` 3, 1, 1 → 3, 4, 4; `cr-post-merger-integration`
3, 3, 2 → 4, 3, 4; `cr-market-entry-nordics` 3, 3, 3 → 4, 3, 4). No delivered
document carries an under-filled page any more; the page-fill rule found
nothing to say on 24 documents where it had found 41 the run before.

What the rationales name now: the cover, two-thirds empty (a design question
for the cover block); a stub last page holding only the notes and sources
(the page-fill rule exempts the last page; a lower threshold there, with
keep-with-previous advice, is the obvious next rule); and, as before, the
argument in prose where a table or chart was owed, in 15 of 24. The two
integrity defects are the wrapped-table-cell matcher gap (#344) again, not
document defects.

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
