---
'@json-to-office/mcp-server': minor
---

Server instructions v2, and a design note on every component.

The instructions used to say how to call the tools. They now also name the design workflow — theme, structure, fill, check, ship — because the failure they were losing to was never a wrong call: it was an agent left to decide look, structure and layout alone at every node, and picking the safe generic option each time. Steps that do not exist yet (blueprints, `jto_scaffold`) are named and marked as such, so an agent knowing the shape of the path takes the parts that are built instead of inventing a route around the gap. The design findings it has to repair are listed by name rather than left to be discovered one validation at a time.

Every component in both formats now carries a `designNote` in `jto_discover` and `jto_describe_component`: one sentence about what good use looks like, where the description says only what the component accepts. Right-align numeric columns and keep the decimals consistent. Say what the section concludes, not what it contains. One idea per slide. Set chart series colours from theme tokens, because the library default palette is not this document.

The notes live in one table inside the package, which is the point. This advice previously existed only in prose outside the product — a skill file, a playground prompt — where it drifted from the schema release after release, until it named components the schema did not define. A drift test now fails the build in both directions: a component with no note, and a note for a component that no longer exists.
