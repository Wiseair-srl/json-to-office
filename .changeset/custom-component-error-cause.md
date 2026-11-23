---
'@json-to-office/core-docx': patch
'@json-to-office/core-pptx': patch
'@json-to-office/jto': patch
---

Keep the original error as `cause` when a custom component's render fails. The message is unchanged, but error trackers such as Sentry can now group failures by the error that actually happened instead of lumping them all under the generator's rethrow.
