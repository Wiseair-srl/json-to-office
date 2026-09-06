---
'@json-to-office/mcp-server': minor
---

`jto_scaffold`: a blueprint, a theme and the facts of a brief become a draft workspace. The tool instantiates a bundled blueprint with the block definitions of the template it names, writes the brief into the metadata and chrome slots of the same name and a markdown outline into the section openers and body text, opens the result as a workspace at revision 1, and returns a fill map listing every `{{…}}` marker still owed — its JSON pointer, kind, budget and guidance, each resolving at that revision. What matches nothing is reported (`W_BRIEF_UNUSED`, `W_OUTLINE_UNMAPPED`), never dropped. `jto://blueprints` serves the plans in full; `jto_discover` keeps the summaries; the server instructions make the scaffold the first move for a report.

`jto_validate` gains `generationReady` and `scaffoldMarkers`: a draft is `valid` with advisory marker findings and not yet ready; once every marker is patched it is. `jto_generate` still refuses any marker, and a repeated diagnostic collapsed under the budget now keeps every path it sat at under `context.paths`, so each marker stays addressable.
