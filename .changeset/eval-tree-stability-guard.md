---
'@json-to-office/mcp-server': patch
---

A run set now knows whether the product moved underneath it.

The manifest was assembled after the last brief, so it described the tree the scorecard was written against rather than the tree any brief actually ran on. A variance run shared a working tree with another session that landed a feature and rebuilt at minute 58 of 76: the twelve runs already finished were measuring the old build, the six that followed died with `does not provide an export named ...` because the process still held the previous `@json-to-office/quality` in its module graph, and the manifest recorded one clean final SHA. The only surviving evidence that anything had happened was a file mtime.

So the tree is captured before the first brief and compared after the last, and a set that straddles a change says so on its own first line. Git alone is not enough — runs import the built packages, so `pnpm build` on an unchanged commit changes the product and leaves no trace in git. The fingerprint covers each package's compiled entry point.
