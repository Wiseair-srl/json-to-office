---
'@json-to-office/core-docx': patch
---

Honour list `props.start` when an explicit `props.levels` array is supplied.

`start` was only read while building levels from the simplified props, so a list
that declared its own `levels` discarded it silently — contradicting the
documented "Level-0 starting number". It is now folded into level 0, and a
`start` declared on the level itself still wins.
