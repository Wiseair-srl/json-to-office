# @json-to-office/design-evals

Measures the design quality of documents an agent produces through the MCP
server. Private to the repo; never published.

```bash
pnpm evals -- --briefs cr-market-entry-nordics       # one brief
pnpm evals -- --out ./evals-out/baseline             # the whole corpus
pnpm evals -- --sealed-corpus /path/to/briefs        # final acceptance only
```

Needs `ANTHROPIC_API_KEY` (or a logged-in Claude Code install) and a built
`packages/mcp-server` — the agent is served the real server over stdio, the
same way Claude Desktop is. It spends money and takes real time; nothing runs
it for you, and no PR is gated on it.

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
