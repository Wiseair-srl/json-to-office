---
'@json-to-office/core-docx': minor
---

Escape the inline mini-language with a backslash.

`\*`, `\_`, `\[`, `\]`, `\{`, `\}` and `\\` now render as themselves. Without
that, a code sample was unwritable: `grant_type=client_credentials` has two
underscores, so the parser read the span between them as emphasis and the
reader got _granttype=clientcredentials_ — visible in the shipped
`technical-guide` for as long as it had code in it.

A backslash before anything else is still a backslash, so `C:\temp` and `50\%`
are untouched, and `parseLiteral` does not unescape: the paths that promise
character-for-character output still give one.
