---
'@json-to-office/jto': patch
---

Plugin components reliably reach editor schemas: the document-schema endpoint
loads requested plugins on demand instead of depending on the playground's
bootstrap `POST /load-plugins` having run first.

The playground fires that bootstrap POST and the first schema fetch in
parallel on page load. When the schema request won the race — or the POST
failed — the plugin registry was empty, the requested plugins were silently
dropped, and Monaco kept (and cached) a plugin-less schema: enabled components
neither completed under `name` nor validated, until a plugin toggle forced a
refetch. `/discovery/schemas/document` now ensures the requested plugins are
registered before generating (in-flight-guarded discover-and-load; the
registry's load fingerprint makes repeats a no-op), so any schema request is
correct regardless of client bootstrap order.
