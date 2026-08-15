# Contributing

json-to-office is an MIT-licensed pnpm monorepo maintained at [Wiseair-srl/json-to-office](https://github.com/Wiseair-srl/json-to-office). This page covers the local development setup, how the monorepo is wired together, and how changes get tested and released.

## Development setup

You need **Node >= 20** and **pnpm** (the repo pins `pnpm@9.15.9` via the `packageManager` field, so [corepack](https://nodejs.org/api/corepack.html) will pick the right version automatically):

```bash
git clone https://github.com/Wiseair-srl/json-to-office.git
cd json-to-office
pnpm install
pnpm build      # build all packages + regenerate root JSON schemas
pnpm test       # run the vitest suites
pnpm check      # lint + typecheck + test in one go
```

Other useful scripts:

| Command                                                   | What it does                                                                               |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `pnpm dev`                                                | `turbo dev --ui tui` — hot-reload dev servers                                              |
| `pnpm test:watch` / `pnpm test:coverage`                  | Vitest in watch / coverage mode                                                            |
| `pnpm lint` / `pnpm lint:fix`                             | ESLint across the workspace                                                                |
| `pnpm typecheck`                                          | TypeScript project-wide type check                                                         |
| `pnpm format` / `pnpm format:fix`                         | Prettier check / write                                                                     |
| `pnpm generate:schemas`                                   | Regenerate `schemas/document.schema.json`, `theme.schema.json`, `presentation.schema.json` |
| `pnpm cli`                                                | Run the CLI from source (`tsx packages/jto/src/cli.ts`)                                    |
| `pnpm cli:dev:docx` / `pnpm cli:dev:pptx`                 | Start a [playground](/guide/playground) from source                                        |
| `pnpm clean` / `clean:dist` / `clean:all` / `clean:cache` | Various levels of cleanup                                                                  |

## Monorepo layout

The pnpm workspace contains `packages/*` plus the VitePress `docs` site (the `services/` directory is deployment infrastructure, not a workspace member). Runtime package dependencies flow strictly upward:

```text
shared                      # format-agnostic types, schemas, validation, fonts
  ├─ shared-docx            # DOCX schemas + component registry
  └─ shared-pptx            # PPTX schemas + component registry
       ├─ core-docx         # DOCX rendering engine (docx.js)
       └─ core-pptx         # PPTX rendering engine (pptxgenjs)
            ├─ json-to-docx # public DOCX API
            └─ json-to-pptx # public PPTX API
                 ├─ jto-cli # lean CLI (generate/validate/schemas/...)
                 └─ jto     # full CLI + dev server + playground (depends on jto-cli)
```

All packages publish under the `@json-to-office` npm scope. See [Architecture](/guide/architecture) for what each layer does at runtime.

### Turbo pipeline

[Turborepo](https://turbo.build) orchestrates the builds:

- `build` depends on `^build` (a package builds only after its workspace dependencies), with `dist/**` as cached output.
- `test`, `test:coverage`, and `typecheck` depend on `^build`; the `test` task's cache is disabled so tests always run.
- A root task, `//#generate:schemas`, depends on the `shared`, `shared-docx`, and `shared-pptx` builds and writes the top-level `schemas/**` files. `pnpm build` runs `turbo build generate:schemas`, so a full build always leaves the [JSON Schemas](/reference/json-schemas) in sync with the source.

## Testing

Tests are written with [Vitest](https://vitest.dev) and live next to the code in `__tests__` directories. Run `pnpm test` locally; CI runs the suite on a matrix of **Node 20 and 22 × ubuntu-latest and windows-latest** for pull requests (pushes to `main` only trigger the release job). Keep platform differences — path separators, binary discovery — in mind.

## Commit conventions

The repo enforces [Conventional Commits](https://www.conventionalcommits.org) via commitlint (`@commitlint/config-conventional`) on a Husky hook, and a pre-commit hook runs lint-staged (`eslint --fix` + Prettier) on staged files. Commits like `feat(pptx): ...`, `fix(cli): ...`, `chore: ...` pass; free-form messages are rejected.

## Release flow (changesets)

Releases are automated with [Changesets](https://github.com/changesets/changesets):

1. **As a contributor**, after making your change, run:

   ```bash
   pnpm changeset
   ```

   Select the affected packages, choose the semver bump, and write a short summary. Commit the generated `.changeset/*.md` file with your PR. Then `pnpm check` and open the PR against `main`.

2. **On merge to `main`**, the CI release job runs `changesets/action@v1`. It either opens/updates a `chore: version packages` PR (collecting pending changesets into version bumps and changelogs) or, when that PR is merged, publishes to npm via `pnpm release` (`pnpm build && changeset publish`).

Configuration notes:

- All `@json-to-office/*` packages are **linked**, so packages that have changesets move to the same new version together. (This is why `@json-to-office/shared` can sit at 0.16.0 while the rest are at 0.20.0 — linking only bumps packages that actually had changesets.)
- `access: public`, base branch `main`, internal dependency bumps as `patch`.

::: tip
You do not need to touch version numbers or changelogs manually — the changeset file is the only release metadata a PR should carry.
:::

## Further reading

- [CONTRIBUTING.md](https://github.com/Wiseair-srl/json-to-office/blob/main/CONTRIBUTING.md) — the canonical contribution guide in the repo
- [CODE_OF_CONDUCT.md](https://github.com/Wiseair-srl/json-to-office/blob/main/CODE_OF_CONDUCT.md) — community standards
- [Architecture](/guide/architecture) — how the packages fit together at runtime
- [CLI guide](/guide/cli) — the tools you'll use while developing
