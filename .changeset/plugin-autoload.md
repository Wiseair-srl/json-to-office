---
'@json-to-office/jto': minor
---

Disk plugins reach hosted playgrounds again, behind `PLUGIN_AUTOLOAD`.

Loading a plugin means importing code the server found by walking its own filesystem, so in production no request may trigger it: the load route wants an API key, and a public playground — running `API_AUTH_MODE=disabled` precisely because a browser cannot keep one — has none to send. The rail listed the bundled plugins anyway, with a switch that changed nothing: `weather` completed, validated and rendered locally, and on the deployment the same document came back `Unknown component "weather"`, with no completion for the name.

`PLUGIN_AUTOLOAD=true` is the operator granting it once, at boot, for the image's own filesystem — a different act from a caller provoking a filesystem scan, which stays refused however the flag is set. The server now preloads what it finds before it takes its first request, so nothing a request carries has to reach the disk: on-demand schema generation and the keyless `POST /discovery/load-plugins` bootstrap remain local-only, as they were. The flag defaults to on in `development` and `test` and off otherwise — a mislabelled `staging` gets the hardened default, like every other setting here — so local development is unchanged. Both hosted playgrounds in `render.yaml` set it.

The playground no longer fires that bootstrap POST at all. Its work is the preload's now, and firing it only gave a keyless deployment a 401 to log and the first schema fetch a race to lose.

Where it is off, the rail says so: disk plugins are still listed and still open their details — the name, the description and the props are worth reading — but their switches are disabled under a line explaining that this server does not load plugins from disk. Browser plugins are unaffected either way; their schemas are composed from what the client sends, and the server never runs them.

Also fixes the plugin count in that eyebrow. It read `active/total` where `active` came from a persisted selection nothing ever pruned, so names of plugins the project no longer has kept counting — three of them against one discovered plugin read `3/1`. Both halves are now counted over the plugins that actually exist, and over all of them rather than the ones a filter left standing.
