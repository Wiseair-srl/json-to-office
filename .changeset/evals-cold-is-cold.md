---
'@json-to-office/mcp-server': patch
---

The "cold" eval runs were not cold.

`allowedTools` waives the permission prompt; it does not restrict what exists. The SDK says so in as many words — "to restrict which tools are available, use the `tools` option instead" — and the first smoke run that worked proved it: the agents called `Bash` eight times, wrote a document to disk with `Write`, read it back, spawned a subagent with `Agent`, and called `ScheduleWakeup`. A baseline taken that way would have measured a full Claude Code session that happens to have an MCP server attached, which is not what any of the programme's targets are about — and none of it showed in the scorecard, whose numbers looked clean.

Cold is now enforced with `tools: []`. Every run also records the tools it used from outside the server, the scorecard counts how many runs were contaminated, and a set with any of them prints a warning above everything else, because a contaminated set is not a baseline no matter how good its numbers look.

This is the third harness defect the smoke runs have caught before the corpus ran, and the most expensive one to have missed: the first two produced obviously wrong output, while this one produced plausible output that measured the wrong thing.
