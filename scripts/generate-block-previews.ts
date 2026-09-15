/**
 * Render the block previews the reference page shows, from the templates
 * that define the blocks (#334).
 *
 * `docs/reference/blocks.md` shows every report and deck block as the house
 * theme draws it. The pictures used to be made by hand — a one-invocation
 * document, LibreOffice, a crop — and went stale whenever a definition moved
 * without anyone remembering to redo them. This script renders each one from
 * the invocation its template authors, which is the same example
 * `jto://blocks` publishes, on the template's own theme; and it records a
 * hash of everything the picture was made from — the definitions the
 * composition reaches, the examples, the theme and the composition itself.
 *
 * The MCP catalog carries the definition and that example, not the picture:
 * an agent that wants to see a block previews its example with `jto_preview`,
 * which is the renderer and theme it will actually generate with. These PNGs
 * are for people reading the reference.
 *
 * `--check` recomputes the hashes and fails when a preview no longer matches
 * its sources, and needs no renderer: `pnpm validate:assets` runs it. What a
 * hash cannot see is the host — the fonts LibreOffice found — so regenerate
 * on a machine with the house fonts installed.
 *
 * Regenerating needs a build (it imports `dist`), LibreOffice and poppler,
 * and a Highcharts export server for `chart-figure` (localhost:7801 unless
 * the core's service configuration says otherwise).
 *
 * Run: pnpm generate:block-previews [--only <block>] [--check]
 */

import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const TEMPLATES = path.join(ROOT, 'packages/jto/src/client/public/templates');
const OUTPUT = path.join(ROOT, 'docs/public/blocks');
const MANIFEST = path.join(OUTPUT, 'manifest.json');

/**
 * Bumped when the way a preview is made changes — composition, crop, size —
 * so every recorded hash goes stale with it.
 */
const GENERATOR = 1;
/** Rendered wide enough that the crop is always scaled down to the width. */
const DOCX_DPI = 150;
const PPTX_DPI = 72;
const WIDTH = 780;
/** Ink lighter than this is paper. */
const PAPER = 235;
const PAD_PT = 12;

type Rec = Record<string, unknown>;
type Format = 'docx' | 'pptx';

/**
 * How a block is set on a page for its picture:
 * - `measure`: in a section of its own, cropped to the text measure and to
 *   the rows that carry ink;
 * - `page`: the whole first page (a cover is a page);
 * - `chrome`: the header band over the footer band of the first page;
 * - `notes`: on a page after blocks that cite sources, so the list has
 *   something to number;
 * - `slide`: the whole slide.
 */
type Composition = 'measure' | 'page' | 'chrome' | 'notes' | 'slide';

interface PreviewSpec {
  block: string;
  template: string;
  composition: Composition;
}

const SPECS: readonly PreviewSpec[] = [
  {
    block: 'cover',
    template: 'client-report-blocks.docx.json',
    composition: 'page',
  },
  {
    block: 'key-takeaways',
    template: 'client-report-blocks.docx.json',
    composition: 'measure',
  },
  {
    block: 'section-opener',
    template: 'client-report-blocks.docx.json',
    composition: 'measure',
  },
  {
    block: 'running-head',
    template: 'client-report-blocks.docx.json',
    composition: 'chrome',
  },
  {
    block: 'kpi-row',
    template: 'client-report-blocks.docx.json',
    composition: 'measure',
  },
  {
    block: 'callout',
    template: 'client-report-blocks.docx.json',
    composition: 'measure',
  },
  {
    block: 'data-table',
    template: 'client-report-blocks.docx.json',
    composition: 'measure',
  },
  {
    block: 'chart-figure',
    template: 'client-report-blocks.docx.json',
    composition: 'measure',
  },
  {
    block: 'figure',
    template: 'client-report-blocks.docx.json',
    composition: 'measure',
  },
  {
    block: 'footnotes',
    template: 'client-report-blocks.docx.json',
    composition: 'notes',
  },
  {
    block: 'memo-header',
    template: 'technical-report-blocks.docx.json',
    composition: 'measure',
  },
  {
    block: 'cover',
    template: 'consulting-deck-blocks.pptx.json',
    composition: 'slide',
  },
  {
    block: 'kpi-row',
    template: 'consulting-deck-blocks.pptx.json',
    composition: 'slide',
  },
  {
    block: 'action-chart',
    template: 'consulting-deck-blocks.pptx.json',
    composition: 'slide',
  },
  {
    block: 'two-column',
    template: 'consulting-deck-blocks.pptx.json',
    composition: 'slide',
  },
  {
    block: 'statement',
    template: 'consulting-deck-blocks.pptx.json',
    composition: 'slide',
  },
];

/** The blocks a `notes` page follows, so the sources it lists exist. */
const CITING_BLOCKS = ['kpi-row', 'data-table'];

interface ManifestEntry {
  file: string;
  block: string;
  template: string;
  composition: Composition;
  hash: string;
}

const formatOf = (template: string): Format =>
  template.endsWith('.pptx.json') ? 'pptx' : 'docx';

const fileFor = (spec: PreviewSpec): string =>
  formatOf(spec.template) === 'pptx'
    ? `${spec.block}-deck-consulting.png`
    : `${spec.block}-consulting.png`;

/** Every definition `name` reaches through invocations in its body. */
function reachable(blocks: Rec, names: readonly string[]): string[] {
  const seen = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== 'object') return;
    const record = value as Rec;
    if (record.name === 'block') {
      const ref = (record.props as Rec | undefined)?.ref;
      if (typeof ref === 'string' && !seen.has(ref) && ref in blocks) {
        seen.add(ref);
        visit(blocks[ref]);
      }
    }
    Object.values(record).forEach(visit);
  };
  for (const name of names) {
    if (seen.has(name)) continue;
    seen.add(name);
    visit(blocks[name]);
  }
  return [...seen].sort();
}

interface Composed {
  format: Format;
  document: Rec;
  /** The theme's file, parsed; absent when the theme has none here. */
  theme?: { page?: { margins?: { left?: number; right?: number } } };
  inputs: unknown;
}

async function compose(spec: PreviewSpec): Promise<Composed> {
  const format = formatOf(spec.template);
  const template = JSON.parse(
    fs.readFileSync(path.join(TEMPLATES, spec.template), 'utf8')
  ) as Rec;
  const { blockReferencesFromDocument } = (await import(
    pathToFileURL(path.join(ROOT, 'packages/shared/dist/index.js')).href
  )) as typeof import('../packages/shared/src/index.js');
  const references = blockReferencesFromDocument(template, {
    template: spec.template,
    format,
  });
  const example = (name: string) => {
    const reference = references.find((entry) => entry.name === name);
    if (!reference)
      throw new Error(`${spec.template} defines no block named ${name}.`);
    return reference.example;
  };
  const props = template.props as Rec;
  const blocks = props.blocks as Rec;
  const invoked =
    spec.composition === 'notes'
      ? [...CITING_BLOCKS, spec.block]
      : [spec.block];
  const definitions = Object.fromEntries(
    reachable(blocks, invoked).map((name) => [name, blocks[name]])
  );
  let children: unknown[];
  if (format === 'pptx') {
    children = [{ name: 'slide', children: [example(spec.block)] }];
  } else if (spec.composition === 'notes') {
    children = [
      { name: 'section', children: CITING_BLOCKS.map(example) },
      {
        name: 'section',
        props: { pageBreak: true },
        children: [example(spec.block)],
      },
    ];
  } else {
    children = [{ name: 'section', children: [example(spec.block)] }];
  }
  const document = {
    name: format,
    props: { ...props, blocks: definitions },
    children,
  };
  const theme = String(props.theme ?? '');
  const themeFile =
    format === 'docx'
      ? path.join(
          ROOT,
          `packages/core-docx/src/templates/themes/${theme}.docx.theme.json`
        )
      : path.join(
          ROOT,
          `packages/core-pptx/src/themes/${theme}.pptx.theme.json`
        );
  // A Windows checkout ends the file's lines in CRLF; the theme is the same.
  const themeText = fs.existsSync(themeFile)
    ? fs.readFileSync(themeFile, 'utf8').replace(/\r\n/g, '\n')
    : undefined;
  return {
    format,
    document,
    ...(themeText !== undefined && {
      theme: JSON.parse(themeText) as Composed['theme'],
    }),
    inputs: {
      generator: GENERATOR,
      composition: spec.composition,
      document,
      theme: themeText ?? theme,
    },
  };
}

const hashOf = (inputs: unknown): string =>
  createHash('sha256').update(JSON.stringify(inputs)).digest('hex');

interface Rgb {
  width: number;
  height: number;
  data: Buffer;
}

function crop(image: Rgb, x0: number, y0: number, x1: number, y1: number): Rgb {
  const left = Math.max(0, Math.floor(x0));
  const top = Math.max(0, Math.floor(y0));
  const right = Math.min(image.width, Math.ceil(x1));
  const bottom = Math.min(image.height, Math.ceil(y1));
  const width = right - left;
  const height = bottom - top;
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    const from = ((top + y) * image.width + left) * 3;
    image.data.copy(data, y * width * 3, from, from + width * 3);
  }
  return { width, height, data };
}

function stack(images: readonly Rgb[]): Rgb {
  const width = Math.max(...images.map((image) => image.width));
  const height = images.reduce((total, image) => total + image.height, 0);
  const data = Buffer.alloc(width * height * 3, 255);
  let y = 0;
  for (const image of images) {
    for (let row = 0; row < image.height; row++)
      image.data.copy(
        data,
        (y + row) * width * 3,
        row * image.width * 3,
        (row + 1) * image.width * 3
      );
    y += image.height;
  }
  return { width, height, data };
}

/** First and last rows between two columns that carry any ink. */
function inkRows(image: Rgb, x0: number, x1: number): [number, number] {
  let first = -1;
  let last = -1;
  for (let y = 0; y < image.height; y++) {
    for (let x = Math.max(0, x0); x < Math.min(image.width, x1); x++) {
      const i = (y * image.width + x) * 3;
      if (
        image.data[i] < PAPER ||
        image.data[i + 1] < PAPER ||
        image.data[i + 2] < PAPER
      ) {
        if (first < 0) first = y;
        last = y;
        break;
      }
    }
  }
  if (first < 0) throw new Error('the page carries no ink to crop to');
  return [first, last + 1];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const onlyIndex = args.indexOf('--only');
  const only = onlyIndex >= 0 ? args[onlyIndex + 1] : undefined;

  const previous: ManifestEntry[] = fs.existsSync(MANIFEST)
    ? (JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))
        .previews as ManifestEntry[])
    : [];

  if (check) {
    const stale: string[] = [];
    const staleBlocks = new Set<string>();
    for (const spec of SPECS) {
      const file = fileFor(spec);
      const recorded = previous.find((entry) => entry.file === file);
      const { inputs } = await compose(spec);
      if (!recorded || !fs.existsSync(path.join(OUTPUT, file))) {
        stale.push(`${file}: never generated`);
        staleBlocks.add(spec.block);
      } else if (recorded.hash !== hashOf(inputs)) {
        stale.push(`${file}: its definitions, example or theme changed`);
        staleBlocks.add(spec.block);
      }
    }
    if (stale.length > 0) {
      // `--only` names a block, and a deck preview's file name is not one.
      process.stderr.write(
        `Block previews are stale — run pnpm generate:block-previews${
          staleBlocks.size === 1 ? ` --only ${[...staleBlocks][0]}` : ''
        }:\n${stale.map((line) => `  ${line}`).join('\n')}\n`
      );
      process.exit(1);
    }
    process.stdout.write(
      `${SPECS.length} block previews match their sources.\n`
    );
    return;
  }

  const preview = (await import(
    pathToFileURL(path.join(ROOT, 'packages/mcp-server/dist/index.js')).href
  )) as typeof import('../packages/mcp-server/src/index.js');

  const entries: ManifestEntry[] = [];
  for (const spec of SPECS) {
    const file = fileFor(spec);
    if (only && spec.block !== only) {
      const kept = previous.find((entry) => entry.file === file);
      if (kept) entries.push(kept);
      continue;
    }
    const { format, document, theme, inputs } = await compose(spec);
    const dpi = format === 'docx' ? DOCX_DPI : PPTX_DPI;
    const rendered = await preview.renderPreview({
      format,
      document,
      dpi,
      outputMode: 'path',
      render: { baseDir: TEMPLATES },
      getAdapter: preview.getAdapter,
      cacheDir: null,
    });
    if (!rendered.ok) {
      throw new Error(
        `${file} could not be rendered: ${rendered.diagnostics
          .map((entry) => entry.message)
          .join('; ')}`
      );
    }
    const pages = rendered.pages;
    const pageIndex = spec.composition === 'notes' ? pages.length - 1 : 0;
    const page = preview.decodePng(pages[pageIndex].png);
    const px = (pt: number) => Math.round((pt * dpi) / 72);
    let picture: Rgb;
    if (spec.composition === 'slide' || spec.composition === 'page') {
      picture = page;
    } else {
      // The measure the theme gives a section, from its page margins; a
      // theme with no file here renders on the default inch.
      const left = (theme?.page?.margins?.left ?? 1440) / 20;
      const right = (theme?.page?.margins?.right ?? 1440) / 20;
      const x0 = px(left - PAD_PT);
      const x1 = page.width - px(right - PAD_PT);
      if (spec.composition === 'chrome') {
        const head = inkRows(crop(page, 0, 0, page.width, px(120)), x0, x1);
        const footTop = page.height - px(120);
        const foot = inkRows(
          crop(page, 0, footTop, page.width, page.height),
          x0,
          x1
        );
        picture = stack([
          crop(page, x0, head[0] - px(PAD_PT), x1, head[1] + px(PAD_PT)),
          crop(
            page,
            x0,
            footTop + foot[0] - px(PAD_PT),
            x1,
            footTop + foot[1] + px(PAD_PT)
          ),
        ]);
      } else {
        const [top, bottom] = inkRows(page, x0, x1);
        picture = crop(page, x0, top - px(PAD_PT), x1, bottom + px(PAD_PT));
      }
    }
    const scaled = preview.downscale(
      picture,
      WIDTH,
      Math.max(1, Math.round((picture.height * WIDTH) / picture.width))
    );
    fs.writeFileSync(path.join(OUTPUT, file), preview.encodePng(scaled));
    entries.push({
      file,
      block: spec.block,
      template: spec.template,
      composition: spec.composition,
      hash: hashOf(inputs),
    });
    process.stdout.write(`${file}: ${scaled.width}×${scaled.height}\n`);
  }
  fs.writeFileSync(
    MANIFEST,
    `${JSON.stringify({ previews: entries }, null, 2)}\n`
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exit(1);
});
