# Changelog

## [2.2.1] - 2026-06-15

### Changed

- Bumped the pinned jto CLI version (`JTO_CLI_VERSION` in `scripts/_lib.py`) from `0.13.0` to `0.16.0`. Applied automatically by `bootstrap.py`'s npx fallback and exposed in `caps.json` as `jto_cli_version`; dependent skills (quote-carousel, blog-cover) pick it up via `scripts/jto_argv.py`. Re-run `bootstrap.py` to refresh a stale `caps.json`.

## [2.2.0] - 2026-06-15

Reconciles the local render-service branch on top of 2.1.0. The 2.1.0 CLI version pin (`JTO_CLI_VERSION`), the dependent-skill helper (`scripts/jto_argv.py`), the eval set, and SKILL.md step 8.5 are all retained.

### Added

- Out-of-process render wiring: `highcharts` charts and docx `visual` graphics render via a hosted service. New `RENDER_SERVER_URL`, `render_env()`, and `has_local_rasterizer()` in `scripts/_lib.py`. `render_preview.py` defaults `HIGHCHARTS_SERVER_URL` (always) and `JTO_PPTX_RASTERIZER_URL` (docx-only, and only when no local rasterizer is found), and warns about cold-start latency and content egress when the hosted instance is used. Both are overridable; a user-set value always wins.
- Cross-platform binary resolution in `bootstrap.py`: new `resolve_binary()` plus `PDFTOPPM_PATH` / `LIBREOFFICE_PATH` env overrides, macOS app-bundle and Windows default-path lookup for `soffice` and `pdftoppm`, mirroring the CLI's own resolver so local rasterization is detected even when LibreOffice is off PATH.
- `visual` DOCX component documented in SKILL.md and the DOCX cheat-sheet; expanded `assets/schemas/document.schema.json` to cover it.

### Changed

- `render_preview.py` now invokes the resolved `pdftoppm` path from `caps.json` instead of a bare command name.
- Expanded `assets/taste/gotchas.md` with additional render-loop lessons.

## [2.1.0] - 2026-06-09

### Added

- `scripts/jto_argv.py`: prints the resolved jto CLI command prefix on one line. Dependent skills (quote-carousel, blog-cover) use it instead of installing the CLI themselves.
- `JTO_CLI_VERSION` in `scripts/_lib.py`: single source of truth for the CLI version across this skill and its dependents. The npx fallback in `bootstrap.py` now uses the pin instead of `@latest`; `caps.json` exposes it as `jto_cli_version`.
- `evals/evals.json`: minimal eval set (DOCX one-pager from brief; PPTX deck from markdown outline) following the skill-creator schema.
- SKILL.md step 8.5: capture non-obvious fixes from the render loop as one-line gotcha candidates for `assets/taste/gotchas.md`, surfaced in the final report when the skill folder is read-only.

## [2.0.0] - 2026-05-19

### Changed

- Complete restructure: SKILL.md rewritten around a render → screenshot → iterate loop.
- Triggers expanded to fire on any deck/slide/presentation/report/brief/Word/PPTX request, not just explicit json-to-office mentions.
- Reference layout reorganized under `assets/` (taste rules, schemas, templates, themes, cheat-sheets).

### Added

- 5 PPTX starting templates (cover, editorial-quote, data-dashboard, executive-deck, pricing) and 4 DOCX templates (editorial-article, executive-brief, invoice, report-long), each with a manifest.
- Curated taste rules: `gotchas`, `typography`, `slide-composition`, `layout-system`, `tables`, `chart-design`, `design-direction`.
- Cheat-sheets for DOCX and PPTX components; full JSON schemas for document, presentation, and theme overrides.
- Reference PNG renders for every template under `references/renders/`.
- Scripts: `bootstrap.py` (capabilities probe), `new_from_template.py`, `preflight.py` (PPTX overflow check), `render_preview.py`, plus shared `_lib.py` / `_gen_manifests.py`.

### Removed

- Legacy `references/` markdown reference docs (replaced by `assets/taste/`, `assets/references/` cheat-sheets, and template manifests).
- `scripts/log_correction.py` (no longer part of the workflow).

## [1.0.0] - 2026-05-03

### Added

- Initial publish to wiseair-skills.
