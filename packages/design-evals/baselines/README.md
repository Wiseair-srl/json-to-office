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
re-authoring anything, and reports how much the judge agrees with itself.

It exists because a spot check found that it often does not. Four stored
documents from the cold baseline, re-judged a day later with the same rubric and
the same model, changed three of the four `wouldShip` answers — including one
the judge scored level 4 and genericness 1, its two best marks, while answering
"no". Graded fields moved far less: no level moved by more than one step.

That ordering matters for how these baselines may be read. The rubric's graded
scores look usable; the binary shipping verdict, which is the metric §1 leads
with, may be mostly the instrument. Until a full re-judge puts a kappa on it,
treat every `wouldShip` comparison in this directory — including the paired cold
versus assisted analysis — as unproven rather than as a result.
