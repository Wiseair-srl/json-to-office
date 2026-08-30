---
'@json-to-office/jto': patch
---

Hosted playground generation no longer 400s on bundled templates that ship
their fonts as `fontRegistry` `kind:'file'` sources (vermilion-annual-report:
"Unsafe outbound source ... local file sources are disabled for HTTP
requests"). The template-media inliner — which already converted a discovered
document's relative images to data URLs before safe-mode source validation —
now also rewrites contained `{kind:'file', path}` font sources to
`{kind:'data'}`, so the fonts pass the policy and travel to the remote
rasterizer. Resolved font bytes are identical to the local file path, so the
LibreOffice preview stages the same faces. A regression suite runs every
bundled template through inlining + safe-mode validation against the
render.yaml host allowlist.

The playground also records template provenance (`templateSource`) when a
discovered document is added, and sends it as `options.sourceName` instead of
the display name — renaming a document created from a bundled template no
longer breaks its media/font resolution.
