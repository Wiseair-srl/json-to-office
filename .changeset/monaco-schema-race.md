---
'@json-to-office/jto': patch
---

The editor stops flagging a browser plugin's component as an unknown `name`.

Every event that can change the component set fires its own schema refresh: each plugin that finishes compiling, each disk-plugin toggle, the editor mounting. On a page holding a few browser plugins that is several requests in flight at once, each carrying a different view of the plugins — and each answering with megabytes of JSON, so they do not come back in the order they were sent. Whichever answer arrived last was installed, newest or not. When an older one arrived late, Monaco was left validating against a schema built before the newest plugin existed, and the component the sidebar showed as Ready read as `Value is not accepted. Valid values: …` in the document — permanently, until a toggle or an edit forced another refresh. The margin was routinely single-digit milliseconds, so which plugins survived a page load was luck. Renaming a component is the reliable way to lose the race: the recompile it triggers refreshes on top of whatever is still in flight.

A refresh now installs its result only if no newer refresh has started since, on the failure path as well — a request that fails late no longer rolls a newer schema back to the plugin-free defaults. Identical requests that are still in flight also share one response, which is what the schema cache behind them could never do: it is empty until the first answer lands, and the duplicates all start before that.

That sharing needed the two reasons a schema is re-fetched to stop being the same call. Wanting an answer that is not a stored one — which every Monaco refresh wants, because the cache key cannot see a plugin rebuilt on disk under an unchanged name — is now `bypassCache`, and a request already on the wire for that exact key is still the answer being asked for. Declaring the server's answer stale stays `clearPluginSchemaCache`, and now reaches requests in flight as well: they were sent against the state just declared stale, so they are no longer handed to callers that ask after that point, and their answers no longer reach the cache.
