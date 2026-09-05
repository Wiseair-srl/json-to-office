# @json-to-office/mcp-server

## 2.4.1

### Patch Changes

- 8716401: A run set now knows whether the product moved underneath it.

  The manifest was assembled after the last brief, so it described the tree the scorecard was written against rather than the tree any brief actually ran on. A variance run shared a working tree with another session that landed a feature and rebuilt at minute 58 of 76: the twelve runs already finished were measuring the old build, the six that followed died with `does not provide an export named ...` because the process still held the previous `@json-to-office/quality` in its module graph, and the manifest recorded one clean final SHA. The only surviving evidence that anything had happened was a file mtime.

  So the tree is captured before the first brief and compared after the last, and a set that straddles a change says so on its own first line. Git alone is not enough — runs import the built packages, so `pnpm build` on an unchanged commit changes the product and leaves no trace in git. The fingerprint covers each package's compiled entry point.

- 1f759bb: The judge can now be measured against itself, and the first look is not reassuring.

  Every taste number this programme reports rests on one absolute verdict per document, which is worth exactly as much as its repeatability — a quantity nobody had measured. Four stored contact sheets from the cold baseline, re-judged a day later with the same rubric and the same model, changed three of four `wouldShip` answers. One of the three flipped to "would not ship" while the same call scored the document level 4 and genericness 1, its two best marks.

  `pnpm rejudge <run-dir>` re-judges a recorded set from the contact sheets already on disk, so a full corpus costs one judge call per document and no authoring at all, and reports Cohen's kappa per rubric field. Kappa rather than agreement: on a corpus where four in five documents are unshippable, a judge that says no to everything agrees with itself 80% of the time and has said nothing.

  If the spot check holds at n=40, the cold-versus-assisted comparison in §1 measures the judge and not the product, and the graded fields — which moved far less, none by more than one step — are the part worth keeping. The recorded baselines now carry that caveat.

## 2.4.0

### Minor Changes

- a2d5563: The nine designed templates now ship inside the package, discoverable with no network.

  They were reachable only from the playground that serves them, which meant the cold path — an agent on Claude Desktop with the server and nothing else — never saw a designed document at all. Now `jto_discover` lists every template with a manifest: archetype, theme, a **measured** page count, a component inventory, a slot inventory saying how many text properties an author actually fills, and a sentence on when to reach for it. `jto://templates/<name>` returns the document; `jto://templates/<name>/thumbnail` returns every page tiled into one low-DPI image, which is what to look at before pulling several hundred kilobytes of JSON into a context window.

  The manifest is generated from the documents by `pnpm generate:gallery` and re-derived by `pnpm validate:assets`, which fails when a document has changed since its manifest was written, when a template has no "when to use" note, or when a bundled document or thumbnail is missing. A manifest that drifts from its document is worse than no manifest: an agent picks a template on what the manifest claims and finds out afterwards.

  Two things are deliberately absent. The **photographs** are not shipped — each manifest lists the image paths its template expects, so an agent copying one knows to supply its own rather than send a client someone else's stock imagery. And **fonts are listed separately** from images, because they are a different problem: a missing photograph is a gap the author fills, a missing typeface silently changes what the whole document looks like.

  **Package size**: 470 KB → 3.71 MB packed, 1.82 MB → 5.09 MB unpacked. The documents contribute 247 KB — they are gzipped, which takes 3.4 MB of coordinate compositions down by a factor of fourteen and is the difference between a bundle worth shipping and one that is not; they are decompressed on read, so a client that never opens a template never pays for one. The remaining ~3 MB is the nine thumbnails, at 180 px per page. That is the whole increase, and it buys the thing the bundle is for: at that size a page render is still legible enough to choose a template by, and below it the sheet only tells you a page exists.

- a6d8532: Server instructions v2, and a design note on every component.

  The instructions used to say how to call the tools. They now also name the design workflow — theme, structure, fill, check, ship — because the failure they were losing to was never a wrong call: it was an agent left to decide look, structure and layout alone at every node, and picking the safe generic option each time. Steps that do not exist yet (blueprints, `jto_scaffold`) are named and marked as such, so an agent knowing the shape of the path takes the parts that are built instead of inventing a route around the gap. The design findings it has to repair are listed by name rather than left to be discovered one validation at a time.

  Every component in both formats now carries a `designNote` in `jto_discover` and `jto_describe_component`: one sentence about what good use looks like, where the description says only what the component accepts. Right-align numeric columns and keep the decimals consistent. Say what the section concludes, not what it contains. One idea per slide. Set chart series colours from theme tokens, because the library default palette is not this document.

  The notes live in one table inside the package, which is the point. This advice previously existed only in prose outside the product — a skill file, a playground prompt — where it drifted from the schema release after release, until it named components the schema did not define. A drift test now fails the build in both directions: a component with no note, and a note for a component that no longer exists.

- c22a911: A document can no longer ship with its slots unfilled.

  Both formats gain `placeholder-text`, one rule answering one question — is this text real yet? — over two codes, because the two answers have different consequences. `W_QUALITY_SCAFFOLD_MARKER` is a slot still holding the `{{…}}` marker a scaffold wrote into it: `jto_validate` lists the markers and still answers `ok: true`, because a draft is a legitimate thing to hold, while `jto_generate` now refuses the document with one path-addressed `E_SCAFFOLD_MARKER` error per remaining slot. `W_QUALITY_PLACEHOLDER_TEXT` is leftover filler — lorem ipsum, "Your title here", "Click to add title", a whole-string `[bracketed placeholder]`, bare `TODO`/`XXX` — and only ever advises: nobody put it there on purpose, and nobody but the author can be sure it is not the real copy.

  The scan visits every string in the authored document rather than a list of text-bearing properties. An allowlist is the tidier thing to write and the wrong thing to ship: it drifts silently as components gain properties, and a marker it misses is a marker generation lets through. The patterns are narrow enough that a colour, a font family or a file path never matches one, and deliberate values authors do write — `TBD`, `N/A`, a citation like `[1]` — are not placeholders. Subtrees with `enabled: false` are skipped; they never reach the page. Neither code carries a fix, because only the author knows what the sentence was meant to say.

  Measured against the eight reference stock templates the finding is exact: 171 true placeholders (lorem ipsum, "Your Subtitle Text Here", "YOUR NAME HERE") and no false positives. Those are demonstration documents whose body copy is filler by design, so the calibration suite records the count per template — copying one and shipping it unedited is precisely what the rule exists to catch, which is a reason to keep it visible rather than to suppress it.

- cb00b1f: `jto_preview` gains `contactSheet: true` — one labelled image tiling every selected page.

  Cross-page consistency is a question about the set: does every section opener look like the others, does the rhythm hold, is the running head on all of them. Asked one page at a time it costs twenty images and answers none of them; asked as a contact sheet it is a single look. The sheet renders at 72 DPI unless `dpi` says otherwise, and each cell carries its page number, so a finding on the sheet can be followed up with a full-resolution preview of that page.

  The composition is plain Node — decode the 8-bit PNGs poppler writes, box-average them down, paste them into a grid, encode one PNG back out. Shelling out to an image tool would have been shorter and would have added a third way for preview to be unavailable on a host that has LibreOffice and poppler. Averaging rather than sampling matters: a page of 9pt text sampled at one pixel in five is speckle, and the sheet exists so that the text still reads as text.

  Delivery follows the same contract as an over-budget page set — inline when it fits, written to the output root with an `info` diagnostic when it does not, refused only when `outputMode: "images"` demanded inlining. The ceiling is bytes _and_ pixels, because bytes alone let the useless case through: forty near-empty pages tile into a nine-megapixel sheet that still deflates under two megabytes, and a client scales an image that large down to roughly 1500px before a model ever sees it, taking every thumbnail below the size at which its text reads. Past four megapixels the sheet is written at full size instead, where it can be opened and zoomed.

  Overlap with the per-page path is deliberate: the pages are still listed with their sizes and cache state, so a caller that spots something on the sheet can ask for that page alone at full resolution.

### Patch Changes

- 0cf9f84: The assisted baseline is recorded, and it does not say what the plan assumed.

  Skill 3.2.0, 40 briefs, judged on renders, no failures and nothing contaminated. The skill was meant to be "today's ceiling" — the level the product should be trying to reach. On the headline metric it reaches 22.5% against the product's own 20%, and the paired comparison shows that is not a small gain but a reshuffle: 6 briefs shipped cold and stopped shipping with the skill, 7 did the reverse, and only 2 of 40 shipped in both. Eighty-two kilobytes of curated taste prose moves shippability by an amount indistinguishable from noise at this sample size.

  What it does move is craft: rubric level improved on 19 briefs and worsened on 6, genericness improved on 18 and worsened on 7, off-palette findings roughly halved. So the guidance works on what a reader notices and not on the decision to send the document — which is the strongest evidence this programme has for its own first principle, and which resets the target. ≥50% is not "catch up with the skill"; it is territory neither the product nor its best prose guidance has reached.

  Two findings for the phases that follow. The skill introduces a regression the Phase 0 rules caught: `W_QUALITY_TEXT_TIGHT` goes from 17 findings across 5 documents to 110 across 7. And across the 25 briefs that ship in neither condition the judges agree on the blockers — generic containers, and charts and tables without units, sources or takeaways, with `table` appearing 117 times in those verdicts against `chart` 53 and `source` 22. Content is not the problem; the same verdicts praise titles that state conclusions.

  Also recorded: before the shipping metric gates a phase, its run-to-run variance needs measuring. Two of forty stable against thirteen flipping is consistent with documents sitting near the boundary and equally consistent with variance large enough to swamp a phase delta.

- 27f188a: Documents the whole design loop on Claude Desktop, and pins the chart paths with tests.

  A new guide covers the configuration that makes preview, durable workspaces and real charts work on one machine — `LIBREOFFICE_PATH` and `PDFTOPPM_PATH` (Claude Desktop does not inherit your shell's `PATH`, which is the usual reason preview reports a missing dependency on a machine that plainly has LibreOffice), `JTO_OUTPUT_DIR`, `JTO_WORKSPACE_DIR`, `HIGHCHARTS_SERVER_URL` — and how to verify each one through `jto_info` rather than assume it.

  It is explicit about what leaves the machine. The `highcharts` component POSTs the complete chart configuration, every data point included, to whatever URL is configured. A local server is the default and stays the default for client work; a private server on your own network is the same posture at team scale; a hosted endpoint is a decision to make deliberately, knowing what it retains, for how long, and who else can reach it.

  An outage fails generation outright rather than dropping the chart, which the guide states and a new test pins: a document that quietly lost its figures is worse than one that was not produced, because only the second is obvious. The same test proves the two fallbacks need nothing — native `chart` and a native `visual` both generate with no export server reachable at all.

  `examples/highcharts-report.docx.json` is committed and was rendered to check what the theme actually reaches. The palette carries: with no `options.colors` the series are painted from the theme in token order, and the fourth series is coloured because the example adds `accent4` through `themeOverrides`, which is what the built-in DOCX themes leave unset. The fonts do not: axis labels, titles and legend come out in the export server's own face at Highcharts' own sizes, so a chart is visibly set in a different typeface from the prose around it. That is a real level-3 coherence defect, documented here with its two workarounds and filed as #354.

- d40df00: The cold baseline is measured and recorded. Spec §1's "today" column was a hypothesis; it now carries numbers.

  Forty briefs, server 2.0.0, `claude-sonnet-5`, judged on renders, no failures and nothing contaminated. Two of the five estimates were pessimistic by roughly 4x — a quarter of cold outputs already reach rubric level 4 and a fifth would be sent to a client unchanged, against estimates of ~5% for both. The rubric median of 3 says where the wall actually is: visual coherence is met, communicative effectiveness is not.

  The integrity row is recorded as **not yet measurable** rather than as 0%. The static rules found no integrity defect in any of the forty documents, but the row asks about _rendered_ defects, the rendered pass does not exist yet, and the spec's own diagnosis puts the static estimator's ceiling at about half of real spills. A 0% there would mean "nothing looked", and would read as a target already beaten.

  The two numbers that carry the most signal are not in the table. Median genericness is 3 of 4 — the documents build, do not break, and read as interchangeable, which is the programme's thesis measured instead of asserted. And 611 `W_QUALITY_OFF_PALETTE` findings across forty documents, about fifteen apiece: the cold agent writes hex by hand and ignores the theme palette entirely, which is the direct case for Phase 1.

  `median 1 iteration` beats its target of 2 for the wrong reason. Split by archetype, `client-report` iterates a median of zero times: the docx runs open no workspace and one never previews at all. They do not iterate because they do not look.

  Baselines live in `packages/design-evals/baselines/` with a README on how to read and reproduce one. Also fixed here: the manifest probed LibreOffice and poppler only from env vars, so the first baseline recorded both as `unavailable` while every page count in it came from a real render — `pdftoppm` reports its version on stderr, which the old probe discarded.

- 34c2851: Adds `packages/design-evals`, the instrument every phase of the design-quality programme is accepted on. Private to the repo; the published server is unchanged apart from the changeset that carries it.

  One command takes briefs from a committed 40-brief corpus — 24 docx and 16 pptx across the three v1 archetypes, with format, archetype, language and data-density metadata — drives a headless Claude agent against the real MCP server over stdio, keeps every artifact, and writes one scorecard. `--briefs` runs a subset; `--sealed-corpus` points at an acceptance set supplied from outside the repo and keeps its text out of everything the run writes, identifying it by hash and stratification instead.

  Three decisions do the work. **Cold by default**: the agent gets the server's instructions and the json-to-office tools, and nothing else — no skill, no project settings, no file or shell access — because the target is what the product alone gets you. **The harness measures; the agent does not report**: every number is recomputed from the document last handed to `jto_generate`, read passively out of the tool call rather than out of a summary, since an author that declares itself finished with a broken document is exactly what this exists to catch. **Failures stay in the denominator**: a run that errored, ran out of turns or ended without generating anything counts as a run and as not shippable, because a denominator that shrinks when the agent gives up is one that improves by giving up.

  Every scorecard carries a reproducibility manifest: git SHA and whether the tree was dirty, package and SDK versions, the exact model and its parameters, hashes of the instructions and of any skill, OS, Node, LibreOffice and poppler versions, the host's font inventory by family, the export-server endpoint class, and the retry budget. A field that could not be read is recorded as `unavailable` rather than dropped — a manifest with a hole is still a manifest; one that quietly shrank is a comparison waiting to mislead.

  The headless runner is a proxy for Claude Desktop, so `agreement()` reports paired ship/no-ship verdicts as raw agreement _and_ Cohen's kappa: on a corpus where most runs fail both ways, raw agreement is what chance would have produced.

  Every deterministic part is tested without a model — corpus parsing, brief selection, metric folding, scorecard denominators, the manifest, agreement statistics, and the runner itself against a scripted agent. A live run needs `ANTHROPIC_API_KEY` and spends money, which is why nothing runs it for you and no PR is gated on it.

- 00bf6e9: The design-evals harness gains a judge, pairwise comparison and calibration. Private to the repo; the published server gains only the preview pipeline as a library export, which the harness renders through so that what a judge looks at is identical to what an author would have looked at.

  `--judge <model>` renders the produced document the way `jto_preview` does, composes one contact sheet, and scores it against the five-level rubric — rendered, never from the JSON, because every question above level 3 is about what a reader sees. It answers the shipping question and rates genericness separately: moving design decisions into a house theme risks making every document look the same, and the scorecard should be able to see that rather than celebrate it as consistency. The rubric prompt is generated from the same table `taste-system.md` defines, so the judge and the rules cannot drift into measuring different things.

  The verdict is evaluative and lives in its own object on the scorecard, so a taste change and a defect change stay distinguishable. A failed run is judged unshippable rather than left out — otherwise a phase improves its rate by producing fewer documents. A judge that throws loses the opinion and keeps the hard numbers.

  Pairwise comparison exists because absolute scores drift: a judge that has seen forty mediocre decks grades the forty-first generously, and a delta made of two absolute scores inherits all of it. Which document is shown first is derived from the pair id rather than from which is newer, because a rater shown the new work in the same position every time learns the position.

  Calibration assembles development-corpus pairs into a rating sheet with the human column blank and the judge's own answer beside it, then reports raw agreement, Cohen's kappa and a percentile bootstrap interval from a seeded PRNG — so "run it again" is not an argument against the number. Unrated pairs are dropped and counted rather than averaged towards whichever answer is convenient. Kappa is reported because agreeing 90% of the time on a corpus that is 90% unshippable is what chance would have done anyway; it comes back as NaN when a rater never varies, rather than as a flattering zero.

  `--repeat <n>` runs each brief more than once, which is how run variance at final acceptance becomes visible instead of averaged.

  Recording the two baselines — server 2.0.0 cold and skill 3.1.0 assisted — and replacing the spec's estimated "today" column with measured values needs a live run with an API key, and is the one step of this ticket that cannot be done from the repo.

- b771b7a: The "cold" eval runs were not cold.

  `allowedTools` waives the permission prompt; it does not restrict what exists. The SDK says so in as many words — "to restrict which tools are available, use the `tools` option instead" — and the first smoke run that worked proved it: the agents called `Bash` eight times, wrote a document to disk with `Write`, read it back, spawned a subagent with `Agent`, and called `ScheduleWakeup`. A baseline taken that way would have measured a full Claude Code session that happens to have an MCP server attached, which is not what any of the programme's targets are about — and none of it showed in the scorecard, whose numbers looked clean.

  Cold is now enforced with `tools: []`. Every run also records the tools it used from outside the server, the scorecard counts how many runs were contaminated, and a set with any of them prints a warning above everything else, because a contaminated set is not a baseline no matter how good its numbers look.

  This is the third harness defect the smoke runs have caught before the corpus ran, and the most expensive one to have missed: the first two produced obviously wrong output, while this one produced plausible output that measured the wrong thing.

- 56b557c: Require a matching successful `jto_generate` response with an artifact before an eval run counts as completed. Record tool results, and recover the workspace revision named by generation rather than a later edited head.

  Sum author usage, tool calls, turns and contamination across retries, retaining failed-session usage and attempt transcripts. Interrupted attempts without final usage mark `cost.usageComplete: false`; their recorded costs are a lower bound.

- 819550a: Three scorecard numbers did not mean what they said. Caught by the first smoke run that worked, and fixed before a baseline could bake the definitions in.

  **"3/3 shippable (100%)"** was a mechanical floor wearing the programme's headline metric's name. It asked only whether the file built, stopped blocking generation and carried no leftover placeholder text — questions with mechanical answers — while the target it appeared to beat by 2x belongs to the judge, which had not looked at anything. It is now `buildsClean`, a test forbids any field in the totals matching `/ship/i`, and a run without a judge prints "no judge: nothing here says whether a document is worth sending".

  **"median 18 iterations"** was the SDK's conversational turn count, roughly equal to the tool-call count, reported under a metric whose target is 2. Iterations now counts edit-and-recheck rounds after the first draft — workspace patches, plus re-drafts past the first — so a run that got it right first time scores 0. The turn count survives beside it as `turns`, because it prices the run.

  **"6 pages"** was the section count of a six-section report, against a metric that compares pages to a blueprint budget. Pages are now measured by rendering the document at 36 DPI where LibreOffice and poppler are present, and every run records whether its count was `rendered` or `structural`, so a corpus measured across two hosts cannot average the two and report a number belonging to neither.

  For the record, that smoke run: 3/3 built clean, no failures, no integrity defects, $2.24 and 11.7 minutes for three briefs. The `W_QUALITY_OFF_PALETTE` and `W_QUALITY_TEXT_TIGHT` findings are Phase 0's own rules firing on real cold-path output, which is the first evidence they work outside a fixture.

- 0ad0498: The assisted eval run would have measured a fifth of the skill.

  `--skill` read one file and appended it to the system prompt. A skill is not a file: `json-to-office` 3.1.0 is an 18 KB `SKILL.md` plus 62 KB of taste and reference documents it refers to — typography, layout, chart design, tables, gotchas, two cheatsheets — which the agent reads on demand. Loading only the first would have captured the workflow and none of the taste, and the assisted run is the programme's _ceiling_: understating a ceiling makes every later phase look better than it is, which is the one direction an eval must never be wrong in.

  `--skill` now takes the skill's directory and inlines the bundle, `SKILL.md` first and each document tagged with its path. That is an approximation — real skill loading is progressive, and the agent decides what to open — so the manifest records `skillMode`, along with the skill's name, version and file list, and a single file still works but is recorded as `file` and warns. The manifest hashes the whole bundle rather than one document.

  Cold runs now also set `skills: []` explicitly. `tools: []` had already removed the Skill tool so nothing could load one, and the recorded baseline is sound — but the SDK is explicit that omitting the option is "not skills off", and a baseline should not rest on one setting happening to imply another.

- ec1c793: An assisted run now records what the skill ships and the agent never got.

  `json-to-office` 3.2.0 turns out to differ from 3.1.0 in exactly one way: it adds a 4 MB bundled template library, which its own workflow says every document starts from. The prose — `SKILL.md` and the taste and reference documents — is the same eleven files, 80 KB to 82 KB.

  That matters for how the assisted baseline is read. With no file tools the agent gets the skill's guidance and cannot open its templates or run its scripts, so the run measures the ceiling of what the skill _says_, not of what it _does_. For this programme that is arguably the right comparison — the templates are already in the server since #322, and the thing being moved into the product is the taste — but it is a distinction the number cannot carry on its own. The loader now counts the files and bytes it left out, the manifest records them as `skillExcluded`, and the run prints the count with the reason.

- d96b842: An eval run reached the operator's company finance server.

  `settingSources: []` keeps a run's _settings_ out — it does not keep other MCP servers out. A project `.mcp.json`, the user's own settings and any installed plugin all still contribute servers, so in the first full cold baseline a pricing-workshop brief called `list-b2b-contracts`, `list-clients` and `revenues-summary` against a real company finance server, pulling contract and revenue data into an eval session. One run in forty. No figures reached the produced document and run output is gitignored, but that path had no business existing: it is a contaminated measurement and a place company data has no reason to be.

  Runs now set `strictMcpConfig`, which restricts the session to the servers the harness passes. The foreign-tool guard added a commit earlier is what made this visible at all, and it now has a test for an unexpected MCP server rather than only for a built-in tool.

  Separately, `analyzeDocument` gained `measurePages`. Counting pages by rendering made a pure function launch LibreOffice, which turned a unit test into a five-second timeout; callers that only want diagnostics can now say so.

- 3b53ddc: The eval harness reported a dollar figure as if it were a bill, and put its headline metric behind an API key nobody on a subscription has.

  `total_cost_usd` is, in the SDK's own words, "an estimate, not a billing statement" — what the tokens would cost at API rates, reported identically whether or not anything was charged. On a claude.ai subscription login the SDK reports `apiKeySource: 'none'` and the run consumes subscription allowance, not money. Every run now records where its credential came from, the scorecard carries the set of credential sources, and a subscription session prints "~$9.89 of model work at API rates (subscription session — not billed)" instead of a number that reads as spend. The costs that actually bite — wall-clock time, since runs are serial, and the credential's own allowance — are what the summary leads with.

  The judge had a worse version of the same problem: it went through the Anthropic SDK directly, which needs `ANTHROPIC_API_KEY`. A subscription has none, so the programme's headline metric — "would you send this to a client unchanged?" — was unreachable on exactly the setup it exists to measure, and the obstacle looked like a budget decision rather than a wiring one. It now runs through the agent SDK on whatever credential the author used, in one turn with no tools. `--judge-api` opts back into the direct SDK for a host that has a key and would rather spend it.

- 152362b: Two settings the documentation named and the server never read.

  The Claude Desktop guide told readers to set `JTO_OUTPUT_DIR` and `JTO_WORKSPACE_DIR`. The server reads `JTO_MCP_OUTPUT_DIR` and `JTO_MCP_WORKSPACE_DIR`. An unknown variable is not an error — it is a setting that silently never applies — so anyone following the guide got durable workspaces and a chosen output directory that quietly did neither.

  The design-evals harness had the same names, invented the same way, and paid for it. It makes a workspace directory and reads the agent's final document out of it; with the variable ignored, the server kept workspaces in memory while the harness searched the disk. Every agent that authored through a handle — which is what the server's own instructions tell it to do — was recorded as having generated nothing. The first smoke run threw away two complete sessions of 19 and 16 turns, both ending in a successful `jto_generate`.

  Both are corrected, and the harness now imports `OUTPUT_DIR_ENV` and `WORKSPACE_DIR_ENV` from the server rather than spelling them out, because spelling them out is what broke it. Verified by spawning the real server over stdio and watching `meta.json` and `rev-1.json` appear where the harness looks.

  A new drift test scans the setup guides for `JTO_*` names and fails on any the source does not read, so documentation cannot invent a setting again.

  Separately, the harness now tells the two failures apart. A session that generated nothing is an authoring failure and a real product result; a session whose document it could not recover is its own, and says so with a `HARNESS:` prefix. Conflating them meant the runs following the recommended path were the ones scored worst — which would have read as a product problem for as long as anyone believed the number.

- 4526e5a: Three defects found reviewing this branch.

  **An off-palette fix could not repair its own finding.** `palette-adherence` emitted `{ op: 'add' }`, which is the same as `replace` on an object member and very different on an array element: RFC 6902 `add` at `/chartColors/0` _splices_, so applying the fix inserted the theme token and left the off-palette hex behind at index 1. The finding survived the patch that was supposed to remove it. Now `replace`, which is always legal here because the value was read from that exact pointer.

  **A truncated PNG decoded to a plausible-looking image.** The contact-sheet decoder's bounds check required both halves of an `&&` that could not be true together, so a short final scanline copied fewer bytes than a row and left the previous row's pixels in the buffer — the bottom of the page silently repeated instead of a refusal.

  **Judge evidence went to a directory that does not exist under `--repeat`.** The eval harness's judge derived its output path from the brief id while the runner writes to `runs/<id>#2`, so every verdict after the first pass failed on the write and was swallowed by the runner's catch. The judge is now handed its own run directory. In the same pass: a run that completed but could not be judged no longer counts as a level-1 document in the median, which reported a judge outage as a quality regression.

- Updated dependencies [ed3a991]
- Updated dependencies [22f6f3e]
- Updated dependencies [c22a911]
- Updated dependencies [4526e5a]
- Updated dependencies [102d8a2]
  - @json-to-office/quality@2.4.0
  - @json-to-office/shared-pptx@2.4.0
  - @json-to-office/jto-ops@2.4.0

## 2.0.0

### Patch Changes

- Updated dependencies [2d1a10b]
  - @json-to-office/shared-docx@2.0.0
  - @json-to-office/jto-ops@2.0.0

## 1.11.0

### Minor Changes

- 3bfa61f: Inline SVG no longer dominates the cost of rendering a DOCX, and the raster
  fallback it produces can be turned off.

  Every inline SVG ships twice: the vector, which Word 2016+ and LibreOffice
  draw, and a PNG in the `fallback` slot for readers older than that. The
  fallback was rasterized one image at a time, which cost about 250ms each and
  went unnoticed while a document held a couple of dozen SVGs. Splitting the
  stock templates' page decoration into a component per motif took several of
  them past two hundred, and generation went from six seconds to seventy-seven.

  Two changes, and the second is the one that matters:

  - Rasters are produced through resvg's `renderAsync` and in a bounded batch
    rather than a serial loop. `Resvg.render()` is synchronous native code, so
    awaiting it never yields — a batch started concurrently still ran one at a
    time on the main thread, which is why simply starting them together changed
    nothing. `renderAsync` hands each raster to libuv's threadpool instead, worth
    roughly 30% (`standard-annual-report` 76.5s → 54.6s). Concurrency is capped at
    eight so the peak stays within the hosted container's memory, each raster
    already being held to a megapixel.
  - `svgRasterFallback: false` — `--no-svg-fallback` on the CLI — skips the raster
    altogether. That is the difference between 76.5s and **2.1s**, and it halves
    the package (1.10 MB → 0.57 MB), because the bulk of an artwork-heavy DOCX is
    fallback PNGs nothing modern ever draws. Rendered output is byte-identical
    through LibreOffice with the flag on or off; the vector is what gets drawn
    either way. docx.js requires the slot to be filled, so the vector bytes go in
    it — the same thing already shipped when a raster could not be produced — and
    only readers old enough to need the raster lose the image. Default is
    unchanged, so no existing output moves.

  Both preview paths take the opt-out, because a preview's answer is a PDF or a
  PNG and LibreOffice draws the vector to make it: the playground's
  `/preview/libreoffice-from-json` and the MCP server's `jto_preview`. Measured
  against the running playground, the stock templates went from 47-62s per
  preview to 5-8s, byte-identical PDFs. Downloads keep the fallback, since those
  bytes go to a reader that may be older than Word 2016.

  Corpus goldens digest every byte and none moved, which is also the check that
  `renderAsync` produces the same PNG as `render()`.

### Patch Changes

- Updated dependencies [3bfa61f]
  - @json-to-office/jto-ops@1.11.0

## 1.10.0

### Patch Changes

- d76f59c: Rename the `rule` component to `divider`.

  `rule` was the typographic term and the word #291 used, but this codebase
  already spends it: `QualityRule`, rule packs, rule ids, `docx/line-box`, and
  OOXML's own `lineRule` sits in the very property the component sets. Prose
  about the component and prose about the lint were a paragraph apart and read
  the same. `divider` is what component libraries settle on for the same reason.

  Nothing but the authored name changes — same props, same paragraph border, same
  collapsed line box, byte-identical output, and the corpus goldens did not move.
  `W_QUALITY_LINE_BOX_COLLAPSE` now points at `"divider"`.

  **Breaking for anyone who wrote `{ "name": "rule" }` against 1.9.0**, which
  shipped the component under its old name. There is no alias: keeping one would
  enshrine the ambiguity the rename exists to remove, and the name was published
  for a matter of minutes. Rename the node; nothing else moves.

- Updated dependencies [d76f59c]
  - @json-to-office/shared-docx@1.10.0

## 1.9.0

### Patch Changes

- 6bfe784: New `rule` component: a horizontal rule, the thin line a brand system draws
  between sections. Follow-up to #291, whose closing note this implements — the
  route that issue caught (an 8pt paragraph with a 1pt exact line box, wanted as
  a 3pt rule) existed because nothing else drew a line: `font.size` floors at
  8pt, `paragraph` has no border, and the alternatives were a `visual`, a
  bordered `text-box` or a one-row table.

  ```json
  {
    "name": "rule",
    "props": { "thickness": 3, "color": "accent", "width": "40%" }
  }
  ```

  `thickness` (points, 0.25–12), `color` (hex or theme token, default the theme's
  `border`), `style` (solid/dashed/dotted/double), `width` (points or `"NN%"`,
  default the full measure), `alignment`, `spacing` (default 6pt either side).

  It compiles to what Word itself draws: an empty paragraph wearing a `w:pBdr`
  bottom border, so the result stays a real Word object rather than a picture of
  a line. The paragraph's own line box is collapsed to 1pt — the same
  construction #291 reports when it is hand-rolled on a paragraph carrying text,
  correct here because there are no glyphs to clip, and done once in the compiler
  so nobody has to reach for it. A partial `width` becomes paragraph indents,
  resolved against the theme page like `image`'s percentage widths; the default
  full-measure rule states no indent at all and is therefore exact wherever it
  lands.

  `W_QUALITY_LINE_BOX_COLLAPSE` now names the component in its suggestion, which
  is the point: that finding is usually someone drawing a line, not setting
  leading.

  Both renderers emit it, from the same IR, byte-identically — `borders` leaves
  the list of features the compiler could only declare and joins the capability
  set both adapters prove with a test. `docxjs` gained paragraph-border emission
  to get there; it had the IR field and dropped it. The empty-paragraph spacer
  idiom is untouched: that draws a gap, not a rule.

- Updated dependencies [aaab6ee]
- Updated dependencies [6bfe784]
  - @json-to-office/shared-docx@1.9.0
  - @json-to-office/quality@1.9.0

## 1.8.1

### Patch Changes

- e7f9fd8: Serialize the durable side of MCP workspaces, so concurrent tool calls cannot
  undo each other (follow-up to #290, shipped in 1.8.0).

  Tool calls are independent async tasks and agents pipeline them, which left two
  orderings broken. A `jto_workspace_close` that deleted the directory while a
  `jto_workspace_patch` was still writing could have the write recreate it, so a
  workspace the agent had been told was destroyed came back on the next use of
  the handle. And two workspaces opened at once each counted the root before
  either had created its directory, so both saw room under `maxWorkspaces` — and
  one could delete the other's half-written directory, which sorts stalest
  precisely because its metadata is not there yet.

  Every durable operation for a connection now runs through one queue, and a
  close performs its delete and its eviction in a single critical section. A
  write that reaches the front of the queue after its workspace is gone declines
  to recreate it and reports `persisted: false`, rather than claiming durability
  for a revision that was never written. The queue is root-scoped rather than
  per-handle on purpose: the count-then-prune sequence is about the root, so a
  per-handle lock would not have covered it.

  Also fixes a hazard found while tracing those: rehydrating a workspace deleted
  the whole directory whenever the head revision file was missing, which a
  concurrent prune causes benignly — a read that picked up revision N's metadata
  a moment before a save committed N+1 and pruned N. It now re-reads the metadata
  before treating a directory as torn.

## 1.8.0

### Minor Changes

- 31ee1de: MCP workspaces can now be disk-backed, so a lost client session no longer
  destroys the revisions it was holding (#290). Workspaces were memory-only:
  `entries`, `tombstones` and every pinned snapshot lived in `Map`s built per
  connection, so a host session reset, a client restart or a crash silently
  discarded all of it — in the field report this came from, five revisions of
  authoring went while the server process itself stayed alive and idle.

  Start the server with `--workspace-dir` (or `JTO_MCP_WORKSPACE_DIR`) and each
  committed revision is mirrored under that root before the tool answers. Memory
  stays the fast path; disk is durability. A reconnecting client calls
  `jto_workspace_list`, gets back every handle under the root — including ones
  this connection never opened — and reads or patches them as usual, with the
  document loaded on demand. The idle TTL still releases memory but no longer
  loses anything, and `jto_workspace_close` still destroys the work, on disk too.

  Off by default, so nothing changes for a connection that does not configure a
  root: handles stay memory-only and end with the connection.

  The root is bounded — 32 workspaces (least-recently-updated evicted first), 9
  revision files each (the head plus its pins), 16 MiB per revision — and a
  revision that cannot be written comes back as a `W_WORKSPACE_NOT_PERSISTED`
  warning with the edit applied, so durability degrades loudly rather than
  silently. Writes are atomic and ordered so the metadata never names a revision
  file that is not there, and a close that cannot delete the durable copy fails
  with `E_WORKSPACE_NOT_CLOSED` and releases nothing, rather than reporting a
  destruction that did not happen. A `workspace` record gains `persisted`,
  `jto_workspace_list` gains `persistence`, and `jto_info.workspaces` gains
  `persistent` and `root`.

## 1.5.0

### Minor Changes

- 9870128: Design quality becomes a first-class pipeline (#216, #218).

  Adds autonomous `@json-to-office/quality`: facts/rules/profiles/policy,
  certainty and evidence, suppressions, budgets, rule isolation, rich diagnostics,
  and explicit gates.

  DOCX/PPTX cores own preparation, authored-path provenance, facts, built-in rule
  packs, and five initial document-class profiles. Official adapters reuse one
  opaque `PreparedDocument` for analysis and rendering. Core entry points and
  format adapters expose the evidence-rich `QualityAnalysis` contract directly.

  CLI, MCP, HTTP, cache hits, and playground generation preserve rich quality
  diagnostics. Advisory remains default; profile/policy can block validation or
  generation before rendering. The executable 15-case reference corpus pins
  poor/professional/excellent verdicts and authored digests; the reference stock
  templates stay warning-clean apart from findings recorded as known-true.

  Estimator thresholds are calibrated against rendered ground truth: a new
  harness (jto-ops `test:ground-truth`) renders mutated stock templates through
  LibreOffice and scores predictions against exact PDF word geometry
  (`extractPdfTextGeometry`, exported from jto-ops). Calibration admits only
  top-aligned, unrotated boxes whose bottom-edge spill is directly comparable.
  The pptx text-fit `characterWidthFactor` moves 0.45 → 0.46 (the measured
  zero-false-warning optimum), pptx text facts gain box geometry, alignment,
  rotation, and compiler-aligned `autoFit`, and one stock template's undersized
  content slot — a measured 25pt real overflow — is fixed. Deterministic
  diagnostics now carry ready-made RFC 6902 `fixes`: fully specified table column
  rescaling, heading level repair, minimum font floor, and a fitting `fontSize`
  for estimated overflows when a size allowed by the active profile/policy fits.

  Three further rules close the gaps a dogfooding pass over the shipped templates
  exposed. DOCX had two active rules, neither about whether text fits, so five
  render defects scored clean: `docx/svg-text-bounds` reports a `<text>` baseline
  past its viewBox, which is never painted and leaves the PDF text layer with it;
  `docx/text-fit` reports a word too wide for its floating frame and a frame whose
  wrapped block runs off the sheet. Its width model sums per-character advances
  rather than applying one factor, since the same face measures 0.694 em/char for
  caps against 0.435 for lowercase, and it speaks only past an 8% overrun — the
  model's measured error against rendered geometry.

  `pptx/text-contrast` adds the accessibility axis, comparing each run against the
  surface actually behind it: its own fill, else the topmost earlier-drawn shape
  covering it, else the slide. Text under an image or chart yields no finding
  rather than a guess. Gradients are sampled at the text box, using a radius
  measured off a rendered slide — the last stop lands at half the bounding-box
  diagonal from the focus corner.

  The four legacy playground decks are removed, so the shipped set is exactly the
  reference corpus. Five render defects and three typos in the remaining templates
  are repaired, and 76 runs are recoloured to the ink that reads best at their
  worst point.

  `jto-cli` no longer truncates `--format json`: `process.exit()` in the same tick
  as a large write discarded whatever was still queued when stdout was a pipe, so
  output stopped at one pipe buffer and became invalid JSON, while a file redirect
  hid the bug entirely. All commands that terminate deliberately now flush first.

### Patch Changes

- Updated dependencies [9870128]
  - @json-to-office/quality@1.5.0
  - @json-to-office/shared@1.5.0
  - @json-to-office/shared-pptx@1.5.0
  - @json-to-office/shared-docx@1.5.0
  - @json-to-office/jto-ops@1.5.0

## 1.4.0

### Minor Changes

- 5dc65ef: The `office-open` renderer is installed rather than advertised, and every surface
  that offers a renderer now says whether it can run.

  `@office-open/docx` and `@office-open/pptx` were optional peer dependencies, so on
  any install that did not opt in — `npx` above all, where there is no project to
  `pnpm add` into — the renderer was listed by `jto_info`, listed per component by
  `jto_discover`, validated against by `jto_validate`, and then failed every render.
  The `visual` component's `renderMode: "native"` went with it, since that mode is
  documented as requiring the backend. They are ordinary dependencies now: ESM-only,
  no native code, no install scripts, 7.4 MB.

  Availability is reported as well as fixed, because an `--omit=optional` install or
  a broken tree can still produce the same gap:

  - `RendererRegistry.statuses()` loads each registered renderer once, memoized, and
    reports `{ id, default, available, reason, installHint }`. Exposed as
    `docxRendererStatuses()` / `pptxRendererStatuses()` and as `rendererStatuses()`
    on the format adapters.
  - `jto_info` returns `formats[].renderers[]` beside the existing `rendererIds`,
    and warns with the install line for any renderer that cannot load.
  - `jto_discover` marks each renderer profile `available`.
  - `jto_validate` warns when the profile a document will actually build with has no
    backend, instead of returning a clean result that the next call contradicts.

  Two error-reporting fixes alongside it:

  - `jto_preview` classified a missing backend as a generic build failure and
    suggested "a build failure is a defect in the JSON, not in the renderer" —
    sending the caller to validate a document that was never at fault. It now
    returns `E_DEPENDENCY_MISSING`, as `jto_generate` already did, and skips the
    validation pass that only added noise.
  - An internal failure no longer puts `error.stack` — absolute filesystem paths and
    module layout — into the tool result, where it reached whatever transcript the
    client keeps. Set `JTO_MCP_DEBUG_STACKS=1` to restore it.

### Patch Changes

- Updated dependencies [47bd0af]
- Updated dependencies [5dc65ef]
- Updated dependencies [f6476d3]
- Updated dependencies [47bd0af]
  - @json-to-office/shared-docx@1.4.0
  - @json-to-office/shared@1.4.0
  - @json-to-office/jto-ops@1.4.0

## 1.2.0

### Minor Changes

- ad35065: Add `@json-to-office/mcp-server`: a local stdio Model Context Protocol server, runnable with `pnpm dlx @json-to-office/mcp-server` or `npx -y @json-to-office/mcp-server`, that lets an agent author, inspect, validate, preview, diff and generate `.docx` and `.pptx` as JSON.

  Tools: `jto_info` (versions, formats and their renderer ids, output root, size limits, and whether the optional preview dependencies are installed); `jto_discover` and `jto_describe_component` for progressive discovery of components, renderer profiles, themes and starters; `jto_validate`, `jto_generate` and `jto_docx_diff` for the authoring loop; `jto_preview` to render selected pages to PNG; and `jto_workspace_*` for connection-scoped documents an agent edits with RFC 6902 patches instead of resending the whole tree. The same catalogues are also published as `jto://` MCP resources for clients that read them.

  Every document-taking tool accepts either inline JSON or `{handle, revision?}`, with identical behaviour. Files are written only under a configured output root (`--output-dir`, `JTO_MCP_OUTPUT_DIR`, else a per-connection temp directory); document defects come back as path-addressed diagnostics rather than protocol errors; stdout carries protocol frames only. `jto_preview` needs LibreOffice and poppler on the host and degrades to a structured, actionable error when either is missing.

### Patch Changes

- ad35065: Make the published PPTX schema and the PPTX validator ask for the same `props`. The generated document schema marked `props` required on every component, including `slide`, whose props are all optional — so `{ "name": "slide", "children": [...] }`, a slide that validates and renders, was flagged by every editor and agent reading that schema. In the other direction the deep validator accepted a bare `{ "name": "text" }`: `text` and `runs` are both optional fields, so an empty props object passed and a missing one passed with it, and the component that exists to draw content was allowed to carry none.

  Requiredness is now one answer per component, held in the registry and read by the schema generator and the deep walk alike: `slide` may omit `props`; every other PPTX component — the `pptx` root, `text`, `image`, `shape`, `table`, `highcharts`, `chart` — must carry it, and its absence is reported as `required_property` at that node's `/props` pointer instead of passing silently.

  **Behaviour change.** Documents that already write `props` everywhere are unaffected. Documents that omitted it on a `text` or an `image` are not: generation runs the deep validator, so those used to produce a file — a slide with nothing drawn on it — and now fail validation with a pointer to the node. That is the intended outcome for `text`, whose whole purpose is the content the key carries; `image` follows because the published schema has required `props` there since it was first generated, and reading the schema's own answer instead would have loosened that contract rather than fixed the disagreement. `image` remains half enforced: the missing key is caught, an empty `"props": {}` is not, since a sourceless image is an `IMAGE_NO_SOURCE` warning at generation rather than an error.

  Three smaller divergences on the same key close with it. `"props": null` was read as an omission by the nested walk — in both formats — while the schema typed the key as an object; it is now reported as a type error at the key it was written on. A slide's `placeholders` record accepted the whole component union, so a `slide`, or the `pptx` root, could sit in a title slot: placeholder values are narrowed to what a slide's `children` accept, in the schema and the walk together, and `jto_describe_component` now names those six components in the slot's schema instead of every component there is. And a registered plugin component may no longer omit `props`, which the published plugin branch has always required — the walk checks the key's presence and leaves its contents to the plugin layer, so the failure arrives as `required_property` at the node rather than as "expected object" from inside the plugin check.

  The generated schemas also declare `$schema` as `http://json-schema.org/draft-07/schema#`, draft-07's own `$id`. The previous `https://` spelling read as an unknown dialect, so a consumer had to rewrite the field or pass `validateSchema: false` before a stock Ajv would compile the schema at all.

  Released as a minor rather than a major deliberately: every document the validator starts rejecting was already invalid against the published JSON Schema for that component, so this brings the runtime into line with the contract it documents rather than changing that contract. The one contract that does change — `slide`'s `props` becoming optional — only accepts more.

- ad35065: Prefix core generation-warning codes into the published `W_` namespace.

  The cores raise warnings under bare names (`FONT_UNRESOLVED`, `CHART_NO_DATA`),
  and `jto_generate` promoted them to a diagnostic's `code` verbatim — so
  `code.startsWith('W_')`, the test that tells an agent a diagnostic does not
  block, was false for the one class of diagnostic that never does. The codeless
  fallback was worse: it read `E_GENERATION_WARNING`, an `E_` prefix on something
  that had not stopped the render, and a code the README never listed. Warnings
  now arrive as `W_FONT_UNRESOLVED` and friends, or `W_GENERATION` when the core
  named nothing, with the core's own spelling kept on `context.code`. Unknown
  named theme fallbacks likewise use `W_UNKNOWN_THEME` rather than an `E_` code.

- Updated dependencies [ad35065]
- Updated dependencies [ad35065]
  - @json-to-office/jto-ops@1.2.0
  - @json-to-office/shared-pptx@1.2.0
  - @json-to-office/shared-docx@1.2.0
  - @json-to-office/shared@1.2.0
