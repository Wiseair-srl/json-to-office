import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import {
  DOCX_FEATURES,
  type DocxFeature,
} from '../packages/core-docx/src/ir/features';
import {
  docxRendererIds,
  resolveDocxRenderer,
} from '../packages/core-docx/src/renderers/registry';
import {
  PPTX_FEATURES,
  type PptxFeature,
} from '../packages/core-pptx/src/ir/features';
import {
  pptxRendererIds,
  resolvePptxRenderer,
} from '../packages/core-pptx/src/renderers/registry';
import { rendererFeatureNotes } from './renderer-feature-notes';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docsPath = path.join(root, 'docs/architecture/office-renderer-ir.md');
const check = process.argv.includes('--check');

type CapabilityRenderer<TFeature extends string> = {
  id: string;
  capabilities: ReadonlySet<TFeature>;
};

function table<TFeature extends string>(
  features: readonly TFeature[],
  notes: Record<TFeature, string>,
  renderers: readonly CapabilityRenderer<TFeature>[]
): string {
  const header = `| Feature | Note | ${renderers
    .map((renderer) => `\`${renderer.id}\``)
    .join(' | ')} |`;
  const separator = `| --- | --- | ${renderers.map(() => '---').join(' | ')} |`;
  const rows = features.map((feature) => {
    const support = renderers
      .map((renderer) => (renderer.capabilities.has(feature) ? 'yes' : '—'))
      .join(' | ');
    return `| \`${feature}\` | ${notes[feature]} | ${support} |`;
  });
  return [header, separator, ...rows].join('\n');
}

function replaceGenerated(
  source: string,
  format: 'PPTX' | 'DOCX',
  generated: string
): string {
  const start = `<!-- BEGIN GENERATED ${format} RENDERER CAPABILITIES -->`;
  const end = `<!-- END GENERATED ${format} RENDERER CAPABILITIES -->`;
  const pattern = new RegExp(`${start}[\\s\\S]*?${end}`);
  if (!pattern.test(source)) {
    throw new Error(
      `Missing ${format} renderer capability markers in ${docsPath}`
    );
  }
  return source.replace(pattern, `${start}\n\n${generated}\n\n${end}`);
}

const pptxRenderers = await Promise.all(
  pptxRendererIds().map((id) => resolvePptxRenderer(id))
);
const docxRenderers = await Promise.all(
  docxRendererIds().map((id) => resolveDocxRenderer(id))
);

let source = await readFile(docsPath, 'utf8');
source = replaceGenerated(
  source,
  'PPTX',
  table<PptxFeature>(PPTX_FEATURES, rendererFeatureNotes.pptx, pptxRenderers)
);
source = replaceGenerated(
  source,
  'DOCX',
  table<DocxFeature>(DOCX_FEATURES, rendererFeatureNotes.docx, docxRenderers)
);
source = await format(source, {
  ...(await resolveConfig(docsPath)),
  parser: 'markdown',
});

const current = await readFile(docsPath, 'utf8');
if (check) {
  if (source !== current) {
    process.stderr.write(
      'Renderer capability docs are stale. Run pnpm generate:renderer-docs.\n'
    );
    process.exitCode = 1;
  }
} else if (source !== current) {
  await writeFile(docsPath, source);
  process.stdout.write('Updated renderer capability docs.\n');
}
