# Recorded baselines

Each file is one complete run set: every run, the aggregate, and the manifest
that says what produced it. They are committed because the programme's targets
are all deltas, and a delta needs a fixed end.

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
