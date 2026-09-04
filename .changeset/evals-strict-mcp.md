---
'@json-to-office/mcp-server': patch
---

An eval run reached the operator's company finance server.

`settingSources: []` keeps a run's _settings_ out — it does not keep other MCP servers out. A project `.mcp.json`, the user's own settings and any installed plugin all still contribute servers, so in the first full cold baseline a pricing-workshop brief called `list-b2b-contracts`, `list-clients` and `revenues-summary` against a real company finance server, pulling contract and revenue data into an eval session. One run in forty. No figures reached the produced document and run output is gitignored, but that path had no business existing: it is a contaminated measurement and a place company data has no reason to be.

Runs now set `strictMcpConfig`, which restricts the session to the servers the harness passes. The foreign-tool guard added a commit earlier is what made this visible at all, and it now has a test for an unexpected MCP server rather than only for a built-in tool.

Separately, `analyzeDocument` gained `measurePages`. Counting pages by rendering made a pure function launch LibreOffice, which turned a unit test into a five-second timeout; callers that only want diagnostics can now say so.
