---
'@json-to-office/design-evals': patch
---

`pnpm rejudge` re-judges every pass of a `--repeat` set, reading each sheet from `runs/<brief>#<pass>` the way the runner wrote it; before, it kept one record per brief and looked for `runs/<brief>`, so a repeated set came back as "no contact sheet" for every document. Rejudged rows carry the run label.
