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
 *     under `packages/` and `examples/` — format and kind come from the
 *     filename. The stock templates live under
 *     `packages/jto/src/client/public/templates/`, so the `packages/` walk
 *     covers them.
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
// Portability
// ----------------------------------------------------------------------------

/**
 * A machine-local absolute path in a shipped asset is schema-valid but broken
 * for everyone else: image lookups resolve against `process.cwd()`, and the
 * PPTX renderer additionally refuses anything outside it. The template rebuilds
 * shipped 65 such paths under `/Users/<name>/...`, which also leaked the
 * author's home directory into every generated deck's image `descr`. Schema
 * validation cannot see this, so it gets its own gate.
 *
 * Matches POSIX absolute (`/x`), home-relative (`~/x`) and Windows drive
 * (`C:\x`) values. Protocol-relative (`//host`) and URLs are not local paths.
 *
 * Only file-reference keys are inspected: prose legitimately starts with a
 * slash ("/month", "/webhooks — Event subscriptions"), so testing every string
 * would flag copy as a broken path.
 */
const LOCAL_PATH = /^(?:\/(?!\/)|~[/\\]|[A-Za-z]:[\\/])/;
const FILE_KEYS = new Set(['path', 'src', 'file', 'fontPath', 'imagePath']);

function collectLocalPaths(json: string): string[] {
  const found = new Set<string>();

  const walkValue = (value: unknown, key: string): void => {
    if (typeof value === 'string') {
      if (FILE_KEYS.has(key) && LOCAL_PATH.test(value)) found.add(value);
    } else if (Array.isArray(value)) {
      // Arrays inherit their property's key: `paths: ["/a", "/b"]`.
      value.forEach((item) => walkValue(item, key));
    } else if (value && typeof value === 'object') {
      for (const [childKey, child] of Object.entries(value)) {
        walkValue(child, childKey);
      }
    }
  };

  try {
    walkValue(JSON.parse(json), '<root>');
  } catch {
    // Unparseable JSON is the schema validator's failure to report, not ours.
  }
  return [...found];
}

// ----------------------------------------------------------------------------
// Synthesized font sub-family names
// ----------------------------------------------------------------------------

/**
 * "Inter Medium", "Geist Light", "Space Grotesk Medium" are strings the render
 * path SYNTHESIZES (`synthesizeFamilyName`, packages/shared/src/fonts/
 * synthesize.ts) from `family` + `fontWeight`. They are not names an author may
 * write: nothing resolves them, so every reference falls through to
 * FONT_UNRESOLVED and no bytes are ever staged for LibreOffice.
 *
 * `FontFamilyNameSchema` is a free-form string, so schema validation cannot see
 * this — which is exactly how 417 of them shipped across 8 stock templates.
 * This is the gate that makes that impossible to repeat.
 */
const SYNTHETIC_FAMILY =
  /^(.+) (Thin|ExtraLight|Light|Regular|Medium|SemiBold|Bold|ExtraBold|Black)( Italic)?$/;

/** Weight each label synthesizes from; used to phrase the fix suggestion. */
const LABEL_WEIGHTS: Record<string, number> = {
  Thin: 100,
  ExtraLight: 200,
  Light: 300,
  Regular: 400,
  Medium: 500,
  SemiBold: 600,
  Bold: 700,
  ExtraBold: 800,
  Black: 900,
};

/**
 * Mirror of `FONT_NAME_KEYS` in packages/shared/src/fonts/collect.ts, plus the
 * `theme.fonts.{heading,body,mono,light}` keys. Kept local because the shared
 * package does not export either set; if collect.ts grows a key, add it here.
 */
const FONT_NAME_KEYS = new Set([
  'family',
  'fontFace',
  'titleFontFace',
  'legendFontFace',
  'dataLabelFontFace',
  'catAxisLabelFontFace',
  'valAxisLabelFontFace',
]);
const THEME_FONT_KEYS = new Set(['heading', 'body', 'mono', 'light']);

interface FontCatalogApi {
  isSafeFont: (name: string) => boolean;
  catalogFamilies: Set<string>;
}

async function loadFontCatalog(): Promise<FontCatalogApi> {
  const shared = await import(
    pathToFileURL(path.join(ROOT, 'packages/shared/dist/index.js')).href
  );
  const families = new Set<string>(
    (shared.POPULAR_GOOGLE_FONTS as { family: string }[]).map((f) =>
      f.family.toLowerCase()
    )
  );
  return { isSafeFont: shared.isSafeFont, catalogFamilies: families };
}

function collectSyntheticFamilies(json: string, api: FontCatalogApi): string[] {
  const found = new Set<string>();

  const known = (name: string): boolean =>
    api.isSafeFont(name) || api.catalogFamilies.has(name.toLowerCase());

  const check = (raw: string): void => {
    const name = raw.trim();
    if (name.length === 0) return;
    // Membership FIRST: "Archivo Black" and "DM Serif Display" are real
    // catalog families that match the regex exactly, and "Archivo" is itself
    // a catalog family — so the regex alone would condemn its own sibling.
    if (known(name)) return;
    const match = SYNTHETIC_FAMILY.exec(name);
    if (!match) return; // unknown third-party family; legitimate, warns at runtime
    if (!known(match[1])) return; // base is unknown too — not a synthesized name
    found.add(name);
  };

  const walkValue = (value: unknown, key: string): void => {
    if (typeof value === 'string') {
      if (FONT_NAME_KEYS.has(key) || THEME_FONT_KEYS.has(key)) check(value);
    } else if (Array.isArray(value)) {
      value.forEach((item) => walkValue(item, key));
    } else if (value && typeof value === 'object') {
      for (const [childKey, child] of Object.entries(value)) {
        walkValue(child, childKey);
      }
    }
  };

  try {
    walkValue(JSON.parse(json), '<root>');
  } catch {
    // Unparseable JSON is the schema validator's failure to report, not ours.
  }
  return [...found];
}

function suggestionFor(name: string): string {
  const match = SYNTHETIC_FAMILY.exec(name);
  if (!match) return name;
  const [, base, label, italic] = match;
  const weight = LABEL_WEIGHTS[label];
  const fix =
    weight === 700
      ? `plus bold: true`
      : `plus fontWeight ${weight} (or bold: true)`;
  const italicNote = italic ? ` and italic: true` : '';
  return (
    `"${name}" is a synthesized sub-family name, not a real family.` +
    ` Use family/fontFace "${base}" ${fix}${italicNote}.`
  );
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

  // Assets only: docs may legitimately illustrate an absolute path in prose.
  const portability = assets
    .map((asset) => ({ asset, paths: collectLocalPaths(asset.json) }))
    .filter((entry) => entry.paths.length > 0);

  // Assets only, same reasoning: docs prose may name a font sub-family.
  const fontCatalog = await loadFontCatalog();
  const synthetic = assets
    .map((asset) => ({
      asset,
      names: collectSyntheticFamilies(asset.json, fontCatalog),
    }))
    .filter((entry) => entry.names.length > 0);

  console.log(
    `Validated ${assets.length} shipped asset(s) and ${snippets.length} docs sample(s).`
  );
  // Say what was not checked: a silent skip reads as "covered" when it isn't.
  if (skipped.length > 0) {
    console.log(`Skipped ${skipped.length} marked docs sample(s):`);
    for (const label of skipped) console.log(`  - ${label}`);
  }

  if (portability.length > 0) {
    console.error(
      `\n${portability.length} shipped asset(s) reference machine-local paths.` +
        ` Use repo-relative paths — these resolve against the process CWD and` +
        ` break for every other checkout:\n`
    );
    for (const { asset, paths } of portability) {
      console.error(`  ${asset.label}`);
      for (const p of paths.slice(0, 5)) console.error(`      ${p}`);
      if (paths.length > 5) {
        console.error(`      ... and ${paths.length - 5} more`);
      }
      console.error('');
    }
  }

  if (synthetic.length > 0) {
    console.error(
      `\n${synthetic.length} shipped asset(s) reference synthesized font` +
        ` sub-family names. These never resolve — no font bytes are staged and` +
        ` the renderer falls back:\n`
    );
    for (const { asset, names } of synthetic) {
      console.error(`  ${asset.label}`);
      for (const name of names) console.error(`      ${suggestionFor(name)}`);
      console.error('');
    }
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} file(s) failed validation:\n`);
    for (const failure of failures) {
      console.error(`  ${failure.label}  (${failure.format} ${failure.kind})`);
      for (const error of failure.errors) console.error(`      ${error}`);
      console.error('');
    }
  }

  if (failures.length > 0 || portability.length > 0 || synthetic.length > 0) {
    process.exit(1);
  }

  console.log('All shipped assets and docs samples are valid.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
