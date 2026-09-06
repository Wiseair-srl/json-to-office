/**
 * Bake the template gallery into the MCP server package.
 *
 * The gallery documents live in the playground's public directory, which is
 * where they are authored and where the playground serves them from. An agent
 * on Claude Desktop can reach neither, so the server ships its own copy: the
 * documents gzipped, a low-DPI thumbnail per template, and a manifest that
 * says what each one is for.
 *
 * Generated rather than hand-maintained, because a manifest that drifts from
 * its document is worse than no manifest — an agent picks a template on what
 * the manifest claims and finds out afterwards. `--check` re-derives
 * everything and fails when anything moved, and `pnpm validate:assets` runs it.
 *
 * Regenerating needs LibreOffice and poppler (the thumbnails are real renders)
 * and, for the templates carrying photography, the media directory next to the
 * sources. Checking needs none of that: it compares the manifest against the
 * documents and leaves the thumbnails alone.
 *
 * Run: pnpm generate:gallery [--check]
 */

import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import zlib from 'zlib';
import { readPreviousGallery } from './gallery-manifest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SOURCE_DIR = path.join(ROOT, 'packages/jto/src/client/public/templates');
const ASSETS = path.join(ROOT, 'packages/mcp-server/assets');
const NOTES_FILE = path.join(ASSETS, 'gallery-notes.json');
const MANIFEST_FILE = path.join(ASSETS, 'gallery.json');
const DOCUMENTS_DIR = path.join(ASSETS, 'templates');
const THUMBNAILS_DIR = path.join(ASSETS, 'thumbnails');

/** Readable enough to judge a layout by, small enough to ship nine of. */
const THUMBNAIL_DPI = 72;
const THUMBNAIL_WIDTH = 180;

type Rec = Record<string, unknown>;

interface Notes {
  templates: Record<string, { archetype: string; whenToUse: string }>;
}

export interface TemplateManifest {
  name: string;
  format: 'docx' | 'pptx';
  archetype: string;
  whenToUse: string;
  theme: string;
  /** Pages for a document, slides for a deck. */
  pages: number;
  /** Component name to count, over the whole document. */
  components: Record<string, number>;
  /** Text-bearing properties an author replaces, by kind. */
  slots: Record<string, number>;
  /**
   * Image paths the document expects to find, relative to its `baseDir`.
   * Not shipped: an agent copying this template supplies its own pictures, and
   * shipping stock photography would invite it to send someone else's.
   */
  externalAssets: string[];
  /**
   * Font files the document names. Kept apart from the images because they are
   * a different problem: a missing photograph is a gap the author fills, a
   * missing typeface silently changes what the whole document looks like.
   */
  externalFonts: string[];
  /** SHA-256 of the source JSON, so drift is detectable without re-rendering. */
  hash: string;
  bytes: { document: number; gzipped: number; thumbnail: number };
}

function walk(node: unknown, visit: (node: Rec) => void): void {
  if (Array.isArray(node)) {
    node.forEach((entry) => walk(entry, visit));
    return;
  }
  if (typeof node !== 'object' || node === null) return;
  const record = node as Rec;
  visit(record);
  for (const value of Object.values(record)) walk(value, visit);
}

function countComponents(document: unknown): Record<string, number> {
  const counts: Record<string, number> = {};
  walk(document, (node) => {
    if (typeof node.name === 'string' && node.props !== undefined) {
      counts[node.name] = (counts[node.name] ?? 0) + 1;
    }
  });
  return Object.fromEntries(Object.entries(counts).sort());
}

/**
 * What an author actually fills in.
 *
 * Counted by property rather than by component, because that is the unit of
 * work: a slide with a title and four labels is five edits, not one.
 */
const SLOT_KEYS: Readonly<Record<string, string>> = {
  text: 'text',
  content: 'text',
  title: 'title',
  subtitle: 'title',
  caption: 'caption',
  notes: 'speaker-notes',
  alt: 'alt-text',
};

function countSlots(
  document: unknown,
  format: 'docx' | 'pptx'
): Record<string, number> {
  const counts: Record<string, number> = {};
  walk(document, (node) => {
    for (const [key, kind] of Object.entries(SLOT_KEYS)) {
      // Only a slide has speaker notes; a table's `notes` are text.
      if (key === 'notes' && format === 'docx') continue;
      const value = node[key];
      if (typeof value === 'string' && value.trim() !== '') {
        counts[kind] = (counts[kind] ?? 0) + 1;
      }
    }
  });
  return Object.fromEntries(Object.entries(counts).sort());
}

function externalFiles(document: unknown): {
  assets: string[];
  fonts: string[];
} {
  const found = new Set<string>();
  walk(document, (node) => {
    const value = node.path ?? node.src;
    if (
      typeof value === 'string' &&
      !value.startsWith('data:') &&
      !/^https?:/.test(value)
    ) {
      found.add(value);
    }
  });
  const all = [...found].sort();
  return {
    assets: all.filter((entry) => !/\.(otf|ttf|ttc|woff2?)$/i.test(entry)),
    fonts: all.filter((entry) => /\.(otf|ttf|ttc|woff2?)$/i.test(entry)),
  };
}

function themeOf(document: unknown): string {
  const props = (document as { props?: Rec }).props;
  const theme = props?.theme;
  if (typeof theme === 'string') return theme;
  if (theme !== undefined) return 'inline';
  return 'default';
}

function slideCount(document: unknown): number {
  const children = (document as { children?: unknown[] }).children ?? [];
  return children.filter(
    (child) =>
      typeof child === 'object' &&
      child !== null &&
      (child as Rec).name === 'slide' &&
      (child as Rec).enabled !== false
  ).length;
}

async function main(): Promise<void> {
  const check = process.argv.includes('--check');
  const onlyIndex = process.argv.indexOf('--only');
  const only = onlyIndex === -1 ? undefined : process.argv[onlyIndex + 1];
  const previous = readPreviousGallery<TemplateManifest>(
    MANIFEST_FILE,
    only !== undefined
  );
  const notes = JSON.parse(fs.readFileSync(NOTES_FILE, 'utf8')) as Notes;
  const names = Object.keys(notes.templates).sort();
  if (onlyIndex !== -1 && (!only || !names.includes(only) || check))
    throw new Error(
      '--only requires an existing template name and cannot be combined with --check.'
    );

  const missing = names.filter(
    (name) => !fs.existsSync(path.join(SOURCE_DIR, name))
  );
  if (missing.length > 0) {
    throw new Error(
      `gallery-notes.json names templates that do not exist: ${missing.join(', ')}`
    );
  }
  const present = fs
    .readdirSync(SOURCE_DIR)
    .filter((name) => name.endsWith('.json'));
  const undocumented = present.filter((name) => !names.includes(name));
  if (undocumented.length > 0) {
    throw new Error(
      `templates with no entry in gallery-notes.json: ${undocumented.join(', ')}. ` +
        'Add an archetype and a "when to use", or the gallery ships a document nobody can choose.'
    );
  }

  if (!check) {
    fs.mkdirSync(DOCUMENTS_DIR, { recursive: true });
    fs.mkdirSync(THUMBNAILS_DIR, { recursive: true });
  }

  // Imported lazily: `--check` must run on a machine with no renderer.
  const preview = check
    ? undefined
    : ((await import(
        pathToFileURL(path.join(ROOT, 'packages/mcp-server/dist/index.js')).href
      )) as typeof import('../packages/mcp-server/src/index.js'));

  const manifests: TemplateManifest[] = [];
  for (const name of names) {
    if (only && name !== only) {
      const existing = previous.find((entry) => entry.name === name);
      if (!existing)
        throw new Error(`${name}: regenerate the full gallery first.`);
      manifests.push(existing);
      continue;
    }
    const source = fs.readFileSync(path.join(SOURCE_DIR, name), 'utf8');
    const document = JSON.parse(source) as Rec;
    const format = name.endsWith('.pptx.json') ? 'pptx' : 'docx';
    const gzipped = zlib.gzipSync(Buffer.from(source), { level: 9 });
    const thumbnailPath = path.join(
      THUMBNAILS_DIR,
      `${name.replace(/\.json$/, '')}.png`
    );

    let pages = format === 'pptx' ? slideCount(document) : 0;
    if (preview) {
      const rendered = await preview.renderPreview({
        format,
        document,
        dpi: THUMBNAIL_DPI,
        outputMode: 'path',
        render: { baseDir: SOURCE_DIR },
        getAdapter: preview.getAdapter,
      });
      if (!rendered.ok) {
        throw new Error(
          `${name} could not be rendered for its thumbnail: ${rendered.diagnostics
            .map((entry) => entry.message)
            .join('; ')}`
        );
      }
      pages = rendered.totalPages;
      const sheet = preview.buildContactSheet(rendered.pages, {
        thumbnailWidth: THUMBNAIL_WIDTH,
      });
      fs.writeFileSync(thumbnailPath, sheet.png);
      fs.writeFileSync(path.join(DOCUMENTS_DIR, `${name}.gz`), gzipped);
      process.stdout.write(
        `${name}: ${pages} page(s), ${Math.round(gzipped.length / 1024)}KB gz, ` +
          `${Math.round(sheet.png.length / 1024)}KB thumb\n`
      );
    }

    manifests.push({
      name,
      format,
      archetype: notes.templates[name].archetype,
      whenToUse: notes.templates[name].whenToUse,
      theme: themeOf(document),
      pages,
      components: countComponents(document),
      slots: countSlots(document, format),
      externalAssets: externalFiles(document).assets,
      externalFonts: externalFiles(document).fonts,
      hash: createHash('sha256').update(source).digest('hex'),
      bytes: {
        document: Buffer.byteLength(source),
        gzipped: gzipped.length,
        thumbnail: fs.existsSync(thumbnailPath)
          ? fs.statSync(thumbnailPath).size
          : 0,
      },
    });
  }

  const body = `${JSON.stringify({ templates: manifests }, null, 2)}\n`;

  if (check) {
    const recorded = fs.existsSync(MANIFEST_FILE)
      ? (JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8')) as {
          templates: TemplateManifest[];
        })
      : { templates: [] };
    const problems: string[] = [];
    for (const manifest of manifests) {
      const entry = recorded.templates.find(
        (candidate) => candidate.name === manifest.name
      );
      if (!entry) {
        problems.push(`${manifest.name}: absent from the manifest`);
        continue;
      }
      if (entry.hash !== manifest.hash) {
        problems.push(
          `${manifest.name}: the document changed since the manifest was written`
        );
      }
      // `pages` needs a renderer, so it is not re-derived here; everything
      // else is, and a hash match means the pages cannot have moved either.
      for (const field of [
        'format',
        'archetype',
        'whenToUse',
        'theme',
      ] as const) {
        if (entry[field] !== manifest[field]) {
          problems.push(`${manifest.name}: ${field} drifted`);
        }
      }
      for (const field of ['externalAssets', 'externalFonts'] as const) {
        if (JSON.stringify(entry[field]) !== JSON.stringify(manifest[field])) {
          problems.push(`${manifest.name}: ${field} drifted`);
        }
      }
      const thumbnail = path.join(
        THUMBNAILS_DIR,
        `${manifest.name.replace(/\.json$/, '')}.png`
      );
      if (!fs.existsSync(thumbnail)) {
        problems.push(`${manifest.name}: no thumbnail shipped`);
      }
      if (!fs.existsSync(path.join(DOCUMENTS_DIR, `${manifest.name}.gz`))) {
        problems.push(`${manifest.name}: no bundled document shipped`);
      }
    }
    for (const entry of recorded.templates) {
      if (!manifests.some((manifest) => manifest.name === entry.name)) {
        problems.push(
          `${entry.name}: in the manifest, but no longer a template`
        );
      }
    }
    if (problems.length > 0) {
      process.stderr.write(
        `The bundled gallery is out of date:\n  ${problems.join('\n  ')}\n\n` +
          'Run `pnpm generate:gallery` (needs LibreOffice and poppler) and commit the result.\n'
      );
      process.exitCode = 1;
      return;
    }
    process.stdout.write(
      `Bundled gallery checked: ${manifests.length} template(s) match their manifest.\n`
    );
    return;
  }

  fs.writeFileSync(MANIFEST_FILE, body);
  const total = manifests.reduce(
    (sum, manifest) => sum + manifest.bytes.gzipped + manifest.bytes.thumbnail,
    0
  );
  process.stdout.write(
    `Wrote ${manifests.length} template(s): ${Math.round(total / 1024)}KB shipped in total.\n`
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
