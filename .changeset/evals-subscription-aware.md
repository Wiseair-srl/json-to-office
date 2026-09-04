---
'@json-to-office/mcp-server': patch
---

The eval harness reported a dollar figure as if it were a bill, and put its headline metric behind an API key nobody on a subscription has.

`total_cost_usd` is, in the SDK's own words, "an estimate, not a billing statement" — what the tokens would cost at API rates, reported identically whether or not anything was charged. On a claude.ai subscription login the SDK reports `apiKeySource: 'none'` and the run consumes subscription allowance, not money. Every run now records where its credential came from, the scorecard carries the set of credential sources, and a subscription session prints "~$9.89 of model work at API rates (subscription session — not billed)" instead of a number that reads as spend. The costs that actually bite — wall-clock time, since runs are serial, and the credential's own allowance — are what the summary leads with.

The judge had a worse version of the same problem: it went through the Anthropic SDK directly, which needs `ANTHROPIC_API_KEY`. A subscription has none, so the programme's headline metric — "would you send this to a client unchanged?" — was unreachable on exactly the setup it exists to measure, and the obstacle looked like a budget decision rather than a wiring one. It now runs through the agent SDK on whatever credential the author used, in one turn with no tools. `--judge-api` opts back into the direct SDK for a host that has a key and would rather spend it.
