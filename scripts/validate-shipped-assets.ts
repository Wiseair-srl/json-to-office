/**
 * Validate every JSON asset this repo ships, plus the full-document samples in
 * the docs, against the current schemas.
 *
 * CI validated `examples/` only, so drift accumulated wherever nothing looked:
 * all five bundled DOCX themes shipped `componentDefaults.table` props that the
 * schema rejects and no renderer read. Built-in themes are loaded with a raw
 * JSON import cast to `ThemeConfigJson`, so neither `tsc` nor the parser ever
 * saw them. This is the gate that makes that impossible to repeat.
 *
 * Covers:
 *   - `*.docx.json`, `*.pptx.json`, `*.docx.theme.json`, `*.pptx.theme.json`
 *     under `packages/` and `examples/` — format and kind come from the filename.
 *   - ```json fences in `docs/**\/*.md` that are full document samples — a
 *     `docx`/`pptx` root with a `children` array. Fragments (a lone component,
 *     a props object, a `$schema` line) are skipped: they are not documents and
 *     have no schema to check against on their own.
 *
 * Per-fence markers, on the line before the fence:
 *   <!-- jto-validate: skip -- reason -->   opt out (e.g. illustrates a plugin
 *                                           component that is not in the base
 *                                           registry)
 *   <!-- jto-validate: docx-theme -->       validate as a theme; themes carry no
 *   <!-- jto-validate: pptx-theme -->       format marker of their own
 *
 * Run: pnpm validate:assets   (requires a build — it imports from dist/)
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const ASSET_ROOTS = ['packages', 'examples'];
const DOCS_ROOT = 'docs';
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.turbo', 'build']);

type Format = 'docx' | 'pptx';
type Kind = 'document' | 'theme';

interface Target {
  /** Repo-relative label, with `:line` for docs snippets. */
  label: string;
  format: Format;
  kind: Kind;
  json: string;
}

interface Failure {
  label: string;
  format: Format;
  kind: Kind;
  errors: string[];
}

// ----------------------------------------------------------------------------
// Collection
// ----------------------------------------------------------------------------

function* walk(dir: string): Generator<string> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

/** Filename suffix decides format and kind; anything else is not ours. */
function classify(file: string): { format: Format; kind: Kind } | null {
  for (const format of ['docx', 'pptx'] as const) {
    if (file.endsWith(`.${format}.theme.json`))
      return { format, kind: 'theme' };
    if (file.endsWith(`.${format}.json`)) return { format, kind: 'document' };
  }
  return null;
}

function collectAssets(): Target[] {
  const targets: Target[] = [];
  for (const root of ASSET_ROOTS) {
    for (const file of walk(path.join(ROOT, root))) {
      const classified = classify(file);
      if (!classified) continue;
      targets.push({
        label: path.relative(ROOT, file),
        ...classified,
        json: fs.readFileSync(file, 'utf8'),
      });
    }
  }
  return targets.sort((a, b) => a.label.localeCompare(b.label));
}

const MARKER = /<!--\s*jto-validate:\s*(skip|docx-theme|pptx-theme)\b/;

function collectDocsSnippets(): { targets: Target[]; skipped: string[] } {
  const targets: Target[] = [];
  const skipped: string[] = [];

  for (const file of walk(path.join(ROOT, DOCS_ROOT))) {
    if (!file.endsWith('.md')) continue;
    const rel = path.relative(ROOT, file);
    const lines = fs.readFileSync(file, 'utf8').split('\n');

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() !== '```json') continue;

      const open = i;
      const close = lines.findIndex(
        (line, index) => index > open && line.trim() === '```'
      );
      if (close === -1) break; // unterminated fence; nothing sane to validate
      const body = lines.slice(open + 1, close).join('\n');
      // Content starts on the line after the fence; lines[] is 0-indexed.
      const label = `${rel}:${open + 2}`;
      i = close;

      // A marker within the few lines above the fence applies to it.
      const marker = lines
        .slice(Math.max(0, open - 3), open)
        .join('\n')
        .match(MARKER)?.[1];

      if (marker === 'skip') {
        skipped.push(label);
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        // Docs contain deliberately elided JSON ("...", trailing prose).
        // Unparseable is not a schema failure; leave it alone.
        continue;
      }

      if (marker === 'docx-theme' || marker === 'pptx-theme') {
        targets.push({
          label,
          format: marker === 'docx-theme' ? 'docx' : 'pptx',
          kind: 'theme',
          json: body,
        });
        continue;
      }

      // A full document sample: a `docx`/`pptx` root with a children array.
      // A root without `children` is prose illustration — a `$schema` line, a
      // `props.grid` block — and would fail on the fields it deliberately omits.
      const root = parsed as { name?: unknown; children?: unknown } | null;
      if (
        (root?.name === 'docx' || root?.name === 'pptx') &&
        Array.isArray(root.children)
      ) {
        targets.push({
          label,
          format: root.name,
          kind: 'document',
          json: body,
        });
      }
    }
  }

  return { targets, skipped };
}

// ----------------------------------------------------------------------------
// Validation
// ----------------------------------------------------------------------------

async function loadValidators() {
  const [docx, pptx] = await Promise.all([
    import(
      pathToFileURL(path.join(ROOT, 'packages/shared-docx/dist/index.js')).href
    ),
    import(
      pathToFileURL(path.join(ROOT, 'packages/shared-pptx/dist/index.js')).href
    ),
  ]);
  return { docx: docx.validateStrict, pptx: pptx.validateStrict };
}

async function main() {
  const validators = await loadValidators();

  const assets = collectAssets();
  const { targets: snippets, skipped } = collectDocsSnippets();
  const targets = [...assets, ...snippets];

  if (assets.length === 0) {
    console.error('No shipped JSON assets found — the walk is misconfigured.');
    process.exit(1);
  }

  const failures: Failure[] = [];

  for (const target of targets) {
    const validator = validators[target.format];
    const result =
      target.kind === 'theme'
        ? validator.jsonTheme(target.json)
        : validator.jsonDocument(target.json);

    if (!result.valid) {
      failures.push({
        label: target.label,
        format: target.format,
        kind: target.kind,
        errors: (result.errors ?? []).map(
          (e: { path?: string; message: string }) =>
            e.path ? `${e.path}: ${e.message}` : e.message
        ),
      });
    }
  }

  console.log(
    `Validated ${assets.length} shipped asset(s) and ${snippets.length} docs sample(s).`
  );
  // Say what was not checked: a silent skip reads as "covered" when it isn't.
  if (skipped.length > 0) {
    console.log(`Skipped ${skipped.length} marked docs sample(s):`);
    for (const label of skipped) console.log(`  - ${label}`);
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} file(s) failed validation:\n`);
    for (const failure of failures) {
      console.error(`  ${failure.label}  (${failure.format} ${failure.kind})`);
      for (const error of failure.errors) console.error(`      ${error}`);
      console.error('');
    }
    process.exit(1);
  }

  console.log('All shipped assets and docs samples are valid.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
