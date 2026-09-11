# @json-to-office/design-evals

Measures the design quality of documents an agent produces through the MCP
server. Private to the repo; never published.

```bash
pnpm evals -- --briefs cr-market-entry-nordics       # one brief
pnpm evals -- --out ./evals-out/baseline             # the whole corpus
pnpm evals -- --sealed-corpus /path/to/briefs        # final acceptance only
```

Needs a logged-in Claude Code install (or `ANTHROPIC_API_KEY`) and a built
`packages/mcp-server` — the agent is served the real server over stdio, the
same way Claude Desktop is. The judge goes through the same credential, so a
claude.ai subscription needs no API key.

It takes real time — a few minutes per brief, run serially — and consumes
whatever allowance the credential has. The scorecard reports a dollar figure,
which is the SDK's estimate of what the tokens would cost **at API rates**: on
a subscription session it is notional and nothing is billed, and the scorecard
says so. Nothing runs this for you and no PR is gated on it.

| Flag              | Meaning                                                                         |
| ----------------- | ------------------------------------------------------------------------------- |
| `--briefs a,b`    | Run a subset of the corpus by id.                                               |
| `--set <id>`      | Run a committed brief set (`briefs/sets/<id>.json`); exclusive with `--briefs`. |
| `--corpus <dir>`  | Read briefs from elsewhere, still openly recorded.                              |
| `--sealed-corpus` | As above, and keep the brief text out of every artifact written.                |
| `--model <id>`    | The exact model to author with. Recorded in the manifest.                       |
| `--skill <path>`  | Run assisted: append this text to the system prompt. Cold without it.           |
| `--max-turns`     | Turn ceiling per brief (default 40).                                            |
| `--max-retries`   | Retries after a failed session (default 1). Counted, never hidden.              |
| `--out <dir>`     | Where the run artifacts and `scorecard.json` go.                                |

Full description of what a scorecard contains, and why the numbers are shaped
the way they are, is in [`docs/architecture/taste-system.md`](../../docs/architecture/taste-system.md#design-evals-measuring-the-whole-loop).

## Delivery and accounting

A completed run requires the final `jto_generate` call to return `ok: true`
with a nonempty artifact. A successful agent session alone does not prove
delivery. The harness records matching tool-call IDs and responses, and reads
the workspace revision reported by generation, even if the agent edits later.

Usage, turns, tool calls and foreign tools include every attempt, including
failed attempts. `transcript.json` retains both the combined events and each
attempt. When a transport interruption prevents final usage reporting,
`cost.usageComplete` is false: the recorded usage is a lower bound.

## Next measurement

Keep the existing baselines as historical evidence. Before using shipping
rates as a gate, recover their rendered artifacts (or produce fresh matched
runs), assemble the 40 development pairs required by #321, and collect Paolo's
ratings. Report agreement and kappa before relying on the judge.

Then repeat the development corpus on a fixed revision with `--repeat 3
--judge`, holding the author model, judge model, skill mode and render environment
constant across comparisons. Compare the new chart/table rules against a
matched run without them; cold versus assisted alone does not measure a PR's
effect. Keep the sealed acceptance corpus for final acceptance.

## What "would ship" means (#409)

`judge.wouldShip` is computed under a named **shipping definition**, and the
scorecard says which (`judge.shipping`: id, hash, and whether it passed
independent verification). A definition combines at most four facts every run
already carries: the judge's answer to a named shipping question, a floor on
its rubric level, the absence of an integrity defect, and a ceiling on pages
the rendered pass found empty or under-filled (`src/shipping.ts`). Until a
definition is frozen it is the status quo — the judge's own answer to the
original question — and until one passes verification the binary rate is
**advisory**: read `excellent` (level ≥ 4) beside it.

Calibrating, freezing and verifying one:

```bash
# Calibration set: the checkpoint artifacts Paolo has judged (96 verdicts).
# Facts as recorded when they were judged: today's engine paginates them differently.
pnpm shipping recorded-facts evals-out/checkpoint-before \
  --page-fill baselines/2026-09-08-page-fill-measure.json --page-fill-set checkpoint-before
pnpm rejudge evals-out/checkpoint-before --question v1 --out evals-out/checkpoint-before/sitting-v1.json
pnpm rejudge evals-out/checkpoint-before --question v2 --out evals-out/checkpoint-before/sitting-v2.json
# … the same for checkpoint-after and checkpoint-after-5, in one sitting …
pnpm shipping calibrate \
  --set before=evals-out/checkpoint-before --set after=evals-out/checkpoint-after \
  --set after-exhibits=evals-out/checkpoint-after-5 \
  --human baselines/2026-09-08-human-checkpoint-verdicts.json \
  --human baselines/2026-09-09-human-checkpoint-verdicts-round2.json \
  --out baselines/<date>-shipping-calibration.json
pnpm shipping freeze --calibration baselines/<date>-shipping-calibration.json \
  --out baselines/shipping-definition.json

# Verification set: fresh artifacts on briefs no calibration artifact shares.
pnpm evals -- --set shipping-verification --out evals-out/shipping-verification   # no --judge
pnpm shipping sheets evals-out/shipping-verification
pnpm shipping reanalyze evals-out/shipping-verification     # fresh artifacts: today's analyzer
pnpm rejudge evals-out/shipping-verification --question <frozen question> \
  --out evals-out/shipping-verification/sitting-<question>.json
pnpm shipping verify --definition baselines/shipping-definition.json \
  --set verification=evals-out/shipping-verification \
  --human baselines/<date>-human-shipping-verification.json \
  --record baselines/shipping-verification.json
```

Three rules keep the number honest. **One label per artifact**: an artifact
judged twice with the same answer carries it; one judged both ways is
`unstable`, counted and left out, and the reviewer's agreement across rounds is
reported on its own. **Allocation by brief**: calibration and verification
share no brief, and kappa's interval is resampled by brief, not by document.
**Freeze, then verify**: the frozen file carries a hash of the definition and
of the whole prompt its judge reads; verification, and every later scorecard,
refuse a definition whose hash no longer matches. Verification also refuses
an artifact from a calibration brief, and verdicts whose `readAt` (when they
left the review page) is not after the freeze. The record is append-only: a
set that verified one definition can never verify another, and the same
definition tries again on it only with `--supersede "<why>"`, both attempts
kept. The target is Cohen's kappa ≥ 0.5 on the verification set; a miss is
recorded as a miss.

Both raters judge the contact sheet, whose pages are thumbnails: "after
reading the argument" means as far as the sheet shows it (the reviewer can
open the sheet at full size; the judge sees it as one image). The page-defect
term is the rubric's own first level — "nothing … empty" — measured by the
rendered pass rather than guessed.

## Claude Desktop against the headless runner (#422)

The headless runner stands in for Claude Desktop in every scorecard. To find
out how well, the same briefs (`briefs/sets/desktop-headless-pairs.json`) run
on both hosts against one server build and one skill, and the server's run
journal makes the Desktop side measurable the same way.

1. Build the server at the commit under test:
   `pnpm turbo build --filter=@json-to-office/mcp-server...`.
2. Point Claude Desktop's `json-to-office` entry at that build, with the journal
   on. In `claude_desktop_config.json`:

   ```json
   {
     "command": "node",
     "args": ["<repo>/packages/mcp-server/dist/cli.js"],
     "env": {
       "JTO_MCP_JOURNAL": "<dir>/journal.jsonl",
       "JTO_MCP_WORKSPACE_DIR": "<dir>/workspaces",
       "JTO_MCP_OUTPUT_DIR": "<dir>/out",
       "HIGHCHARTS_SERVER_URL": "http://localhost:7801"
     }
   }
   ```

3. Match the conditions the headless side will use: the same skill enabled
   (the workflow-only `json-to-office` 4.0.0, nothing older), the same model
   (`claude-sonnet-5`), and no other connector enabled in the conversation, so
   no tool outside the server can be reached. Check the export server is
   healthy (`curl localhost:7801/health`).
4. For each brief: quit and reopen Claude Desktop, so the brief meets a fresh
   server exactly as a headless run does; start a new conversation; paste the
   output of `pnpm desktop prompt <brief>`; let it run to the end. If it stops
   to ask something, answer once, "Proceed without asking", and note it — a
   headless run has nobody to ask.
5. Import: `pnpm desktop sessions --journal <dir>/journal.jsonl` lists the
   sessions; map each to its brief and run
   `pnpm desktop import --journal <dir>/journal.jsonl --run <brief>=<session>… --model claude-sonnet-5 --app-version <Desktop version> --skill <skill dir> --out evals-out/desktop-pairs`.
6. Headless, same commit and skill:
   `pnpm evals -- --set desktop-headless-pairs --skill <skill dir> --out evals-out/headless-pairs`.
7. Judge both sets in one sitting with the frozen definition's question
   (`pnpm rejudge … --question <q> --out <dir>/sitting-<q>.json`), then
   `pnpm desktop compare --desktop evals-out/desktop-pairs --headless evals-out/headless-pairs --out baselines/<date>-desktop-vs-headless.md`.

Every journalled session that made a call is either mapped to a brief
(`--run <brief>=<session>`; two sessions on one brief become `<brief>#1`,
`#2`) or excluded with a reason (`--exclude <session>=<why>`), so an abandoned
attempt stays in the record. `--intervened <brief>` marks a run where the
reviewer answered the agent.

What Desktop does not report — turns, tokens, and any tool the model reached
outside the server — is marked unobservable on each imported run, and the
scorecard's aggregates leave those runs out rather than reading a zero. The
delivered document is checked against the digest the server recorded when it
generated it, and the file against the digest of its bytes; a file that is
gone or changed makes the run a failure. Each session records a digest of the
server script it ran, and the import checks it against this tree's build.

Known differences the comparison cannot remove, reported beside it: headless
runs inline the skill into the system prompt while Desktop loads it when it
triggers; headless retries a failed session once, Desktop does not; and a
Desktop run can be interrupted by a person.

Run the Desktop half after the verification review (#409), not before: the
deck briefs here are also verification briefs, and seeing a Desktop document
first would expose the reviewer to them before judging.

## Brief sets

`briefs/sets/<id>.json` names a fixed selection with the reason each brief is
in it. `client-report-checkpoint` is the 6–8 client-report briefs #360 chose
before any implementation comparison — narrative, dense tables, long text and
chart labels, across all three densities — designed for three runs each. The
same set runs against the current product and against the report milestone:

```bash
pnpm evals -- --set client-report-checkpoint --repeat 3 --judge --out ./evals-out/checkpoint-before
```

Without `--repeat` a set runs at its own `repeat`; with it, the flag wins and
the CLI says when that falls short of the design. The scorecard records the
set's id, the hash of its file, the runs it was designed for and the runs
made, so a comparison across an edited or under-run set says so.

## Briefs

`briefs/<id>.md` — frontmatter (`id`, `format`, `archetype`, `language`,
`density`, `title`) and a body written the way a colleague would ask for the
document. The id must match the filename: `--briefs` addresses a brief by id,
and a filename saying otherwise makes the selector lie about what ran.

A brief says what the document is for and gives it real numbers to display. It
never says how the document should look — that is the thing under measurement.

## Assisted runs

`--skill` takes the skill's **directory**. A skill is not a file:
`json-to-office` 3.1.0 is an 18 KB `SKILL.md` plus 62 KB of taste and reference
documents it refers to, and loading only the first measures a fifth of it. The
assisted run is the programme's ceiling, and understating a ceiling makes every
later phase look better than it is.

The bundle is inlined into the system prompt — `SKILL.md` first, then every
other Markdown document, each tagged with its path. That is an approximation of
how a skill really behaves: real loading is progressive, and the agent decides
what to open. Inlining everything is generous rather than stingy, which is the
right direction for a ceiling, and the manifest records `skillMode` so nobody
reads the result as a measurement of skill loading itself. Passing a single
file still works, is recorded as `skillMode: 'file'`, and prints a warning.
