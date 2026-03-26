# Contributing to json-to-office

Thanks for your interest in contributing! This guide will help you get started.

## Prerequisites

- Node.js >= 20
- [pnpm](https://pnpm.io/) (version specified in `package.json` `packageManager` field)

## Setup

```bash
git clone https://github.com/Wiseair-srl/json-to-office.git
cd json-to-office
pnpm install
pnpm build
```

## Development workflow

```bash
pnpm dev          # Start dev server with hot reload
pnpm build        # Build all packages
pnpm test         # Run tests
pnpm lint         # Lint all packages
pnpm typecheck    # Type-check all packages
pnpm check        # Run lint + typecheck + test
```

## Making changes

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Add a changeset: `pnpm changeset`
   - Select the packages affected by your change
   - Choose the semver bump type (patch/minor/major)
   - Write a short summary of the change
4. Ensure `pnpm check` passes
5. Open a pull request

## Commit conventions

We use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` new feature
- `fix:` bug fix
- `docs:` documentation only
- `chore:` maintenance tasks
- `refactor:` code change that neither fixes a bug nor adds a feature
- `test:` adding or updating tests

## Code style

- ESLint and Prettier are configured — run `pnpm lint:fix` and `pnpm format:fix`
- Pre-commit hooks run automatically via Husky

## Project structure

```
packages/
  shared/        # Format-agnostic schemas and validation
  shared-docx/   # DOCX-specific schemas
  shared-pptx/   # PPTX-specific schemas
  core-docx/     # DOCX generation engine
  core-pptx/     # PPTX generation engine
  json-to-docx/  # Public DOCX API
  json-to-pptx/  # Public PPTX API
  jto/           # CLI + dev server + playground
```

## Questions?

Open a [Discussion](https://github.com/Wiseair-srl/json-to-office/discussions) or file an issue.
