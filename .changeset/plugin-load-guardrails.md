---
'@json-to-office/jto': patch
'@json-to-office/jto-cli': patch
---

Harden on-demand plugin loading for schema generation (review follow-ups to
the load-on-demand fix):

- Production keeps its authorization policy: on-demand loading is a
  dev-playground affordance, so in production `/discovery/schemas/document`
  no longer triggers plugin discovery — loading stays behind the
  authenticated `POST /load-plugins`, and schema generation falls back to
  whatever is already registered.
- `PluginRegistry.discoverAndLoad()` now coalesces concurrent callers into a
  single discovery pass, so the bootstrap POST and on-demand schema loads
  racing on page load no longer double-walk the project or re-import plugins.
