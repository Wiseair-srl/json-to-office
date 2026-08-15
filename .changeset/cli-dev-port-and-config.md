---
'@json-to-office/jto-cli': minor
'@json-to-office/jto': minor
---

fix(cli): honour `PORT` in `jto dev`, and drop the dev-server config keys nothing read

`PORT` was parsed in two places and read in neither: the dev server took its port from `-p`, the config file, or a `server.port === 3003` sentinel that stood in for "the user did not choose a port". The sentinel could not tell an untouched default from a deliberate `3003`, so `jto pptx dev` with `PORT=3003` — or with `"server.port": 3003` in the config file — bound 3004 instead.

- `loadConfig` resolves the port in one place: config file > `PORT` > the caller's default > the packaged `3003`. `dev -p` still outranks all of them.
- `loadConfig` takes an optional second argument (`{ defaultPort }`), so `dev` supplies the format's port instead of the loader emitting a magic value the caller has to recognise. The parameter is optional and existing call sites keep working.
- The returned config is a fresh `structuredClone` of the defaults on every load, including the failure path. `dev -p` writes straight into `config.server.port`, which used to mutate the shared module-level `defaultConfig`, leaking one command's port into every later load in the same process.
- A config file that fails schema validation still falls back to defaults, but the fallback now honours `PORT` and the caller's default rather than always returning `3003`.
- The dev-server config schema keeps only what the dev server reads (`mode`, `server.port`, `server.host`, `development.hmrPort`). `server.cors.*`, `api.*`, `playground.*`, `paths.*`, and `development.hmr` / `sourceMap` / `verbose` are gone rather than left to imply an effect they never had. Unknown keys still validate, so a config file that still carries them keeps loading and they keep being ignored. CORS is configured through `CORS_ORIGIN`.
- `jto`'s server config no longer parses `PORT` and `UPLOAD_DIR` into an object nobody consulted; the listener's port comes from the CLI config above.

**Behaviour changes to expect when upgrading:**

- **`PORT` now decides the dev-server port** when `-p` is absent and the config file sets no `server.port`. A deployment that exports `PORT` for some other process and previously landed on 3003/3004 will now bind `$PORT`. Pin the port with `-p` or `server.port` if you need the old value.
- **`PORT=3003 jto pptx dev` binds 3003**, not 3004.

Port parsing is strict: `Number.parseInt` stops at the first non-digit, so `PORT=8080x` used to bind 8080. Both `PORT` and `--port` now require a complete integer in range, and an invalid `--port` fails with a clear message instead of silently binding elsewhere. `loadConfig` also survives a malformed config file — a top-level `null`, or `"server": null`, previously threw while computing the fallback port and skipped the warn-and-default path that exists for exactly that case.
