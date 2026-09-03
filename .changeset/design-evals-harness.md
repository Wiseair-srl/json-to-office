---
'@json-to-office/mcp-server': patch
---

Adds `packages/design-evals`, the instrument every phase of the design-quality programme is accepted on. Private to the repo; the published server is unchanged apart from the changeset that carries it.

One command takes briefs from a committed 40-brief corpus — 24 docx and 16 pptx across the three v1 archetypes, with format, archetype, language and data-density metadata — drives a headless Claude agent against the real MCP server over stdio, keeps every artifact, and writes one scorecard. `--briefs` runs a subset; `--sealed-corpus` points at an acceptance set supplied from outside the repo and keeps its text out of everything the run writes, identifying it by hash and stratification instead.

Three decisions do the work. **Cold by default**: the agent gets the server's instructions and the json-to-office tools, and nothing else — no skill, no project settings, no file or shell access — because the target is what the product alone gets you. **The harness measures; the agent does not report**: every number is recomputed from the document last handed to `jto_generate`, read passively out of the tool call rather than out of a summary, since an author that declares itself finished with a broken document is exactly what this exists to catch. **Failures stay in the denominator**: a run that errored, ran out of turns or ended without generating anything counts as a run and as not shippable, because a denominator that shrinks when the agent gives up is one that improves by giving up.

Every scorecard carries a reproducibility manifest: git SHA and whether the tree was dirty, package and SDK versions, the exact model and its parameters, hashes of the instructions and of any skill, OS, Node, LibreOffice and poppler versions, the host's font inventory by family, the export-server endpoint class, and the retry budget. A field that could not be read is recorded as `unavailable` rather than dropped — a manifest with a hole is still a manifest; one that quietly shrank is a comparison waiting to mislead.

The headless runner is a proxy for Claude Desktop, so `agreement()` reports paired ship/no-ship verdicts as raw agreement _and_ Cohen's kappa: on a corpus where most runs fail both ways, raw agreement is what chance would have produced.

Every deterministic part is tested without a model — corpus parsing, brief selection, metric folding, scorecard denominators, the manifest, agreement statistics, and the runner itself against a scripted agent. A live run needs `ANTHROPIC_API_KEY` and spends money, which is why nothing runs it for you and no PR is gated on it.
