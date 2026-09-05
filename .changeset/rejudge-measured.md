---
'@json-to-office/mcp-server': patch
---

The judge's repeatability has a number now, and the earlier alarm was overstated.

A four-document spot check had changed three verdicts and suggested the shipping metric was mostly noise. Over all 39 uncontaminated cold-baseline documents, re-judged a day later with the same rubric and model, it is not: 90% agreement and a kappa of 0.73 on `wouldShip`, which is substantial. By kappa the binary verdict is the best-behaved field on the rubric, not the worst — `level` agrees exactly only 62% of the time (kappa 0.45), though just one document moved by more than a single step.

What survives is worse than noise, because it has a direction. All four verdicts that changed moved the same way, no to yes: the same corpus scored 8 shippable one day and 12 the next, with nothing moving back. The instrument does not wobble around a stable centre, it drifts, and the drift between two sessions is four documents. The cold-to-assisted difference §1 reports is one document, and the two sets were judged on different days.

So the paired cold-versus-assisted analysis is neither evidence for the skill nor against it: its zero moved by more than the effect it was measuring. Re-judging both sets in a single pass costs one call per document and no authoring, and is the minimum a comparison needs. `judgePair` is the version that survives drift outright.

`rejudge` also now skips contaminated runs. The raw cold scorecard on disk and the committed baseline reported 9 shippable and 8 for the same forty runs, because one of them still carried the brief that had called into an unrelated MCP server.
