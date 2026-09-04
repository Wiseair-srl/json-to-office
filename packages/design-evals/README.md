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

| Flag              | Meaning                                                               |
| ----------------- | --------------------------------------------------------------------- |
| `--briefs a,b`    | Run a subset of the corpus by id.                                     |
| `--corpus <dir>`  | Read briefs from elsewhere, still openly recorded.                    |
| `--sealed-corpus` | As above, and keep the brief text out of every artifact written.      |
| `--model <id>`    | The exact model to author with. Recorded in the manifest.             |
| `--skill <path>`  | Run assisted: append this text to the system prompt. Cold without it. |
| `--max-turns`     | Turn ceiling per brief (default 40).                                  |
| `--max-retries`   | Retries after a failed session (default 1). Counted, never hidden.    |
| `--out <dir>`     | Where the run artifacts and `scorecard.json` go.                      |

Full description of what a scorecard contains, and why the numbers are shaped
the way they are, is in [`docs/architecture/taste-system.md`](../../docs/architecture/taste-system.md#design-evals-measuring-the-whole-loop).

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
