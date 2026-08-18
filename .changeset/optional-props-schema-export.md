---
'@json-to-office/shared-docx': patch
---

Export `props` as optional for components that do not require it.

Every component variant in the generated JSON Schema listed `props` in
`required`, including `section`, `toc`, `image` and `text-box`, whose props
carry no required field. The runtime disagrees: it treats an omitted `props` as
`{}` and lets the props schema decide. Schema-driven editors trusted the export
and reddened documents that build — the playground reported 23 errors on the
shipped `tech-report` template, one per propless `section`. The root `docx` node
already carried this fix locally; it now applies to every component.

Root `children` moves into the schema as a required field. It was enforced only
by the deep validator, which runs on the fallback path taken when the TypeBox
check has already failed — so it fired only as a side effect of `props` being
required. CI now validates the stock playground templates against the generated
schemas, which is what would have caught the drift: the previous step only
checked two examples that write `props` on every node.
