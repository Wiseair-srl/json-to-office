/**
 * The render manifest: one entry per image embedded in a generated `.docx`,
 * saying which node of the returned definition produced it.
 *
 * Built from the package itself, not predicted: the blips are read out of
 * `word/document.xml` and each header and footer part in the order a reader
 * meets them, and paired with the image runs of the IR the bytes were
 * rendered from, which a backend writes in that same order. Each pair is then
 * checked against the media bytes — the blip must point at the very bytes
 * the run's resource holds — so a manifest that comes back is one whose every
 * entry was confirmed against the file, and a package the pairing cannot
 * account for yields no manifest rather than a wrong one.
 */

import AdmZip from 'adm-zip';
import { posix } from 'node:path';
import type {
  DocxIR,
  DocxIrBlock,
  DocxIrDrawingPicture,
  DocxIrHeaderFooterSet,
  DocxIrImageRun,
  DocxIrInline,
  DocxIrParagraph,
  DocxIrResource,
} from '../ir/types';
import type { ImageOrigins } from '../ir/compiler';
import { sha256Hex } from '../ir/units';

/** Where in the package an image sits. */
export type RenderManifestPart = 'body' | 'header' | 'footer';

/** One embedded image occurrence and the definition node that produced it. */
export interface RenderManifestEntry {
  /** `body` for `word/document.xml`; `header` or `footer` for page chrome. */
  part: RenderManifestPart;
  /** The package part holding the `<a:blip>`, e.g. `word/document.xml`, `word/header1.xml`. */
  partPath: string;
  /**
   * The media file the blip embeds, e.g. `word/media/image12.png`. Identical
   * images are stored once, so two entries can name the same file.
   */
  mediaPath: string;
  /** Lowercase hex SHA-256 of the media file's bytes. */
  sha256: string;
  /**
   * Dot path of the producing node in the returned `standardDefinition`, e.g.
   * `children.4.children.2` or `children.0.props.header.0`.
   */
  standardPath: string;
  /** The standard component at `standardPath`: `image`, `highcharts`, `visual`, … */
  kind: string;
  /**
   * Present only when the node came from a custom component kept by
   * `preserveCustomComponents`: the dot path of that component in the
   * returned `preservedDefinition`. Every node one preserved component emits
   * carries the same path.
   */
  sourcePath?: string;
  /** The preserved custom component's name, alongside `sourcePath`. */
  sourceKind?: string;
}

/**
 * Every embedded image, body first in the order of the `<a:blip r:embed>`
 * elements of `word/document.xml`, then each section's header and footer
 * parts in section order. One entry per occurrence, not per media file.
 */
export type RenderManifest = RenderManifestEntry[];

/** A custom-component origin recorded while the definition was expanded. */
export interface SourceOrigin {
  sourcePath: string;
  sourceKind: string;
}

/**
 * Standard-definition dot paths mapped to the preserved component whose
 * expansion they root. A node's origin is that of its nearest recorded
 * ancestor-or-self.
 */
export type SourceOrigins = ReadonlyMap<string, SourceOrigin>;

export type RenderManifestBuild =
  | { ok: true; manifest: RenderManifest }
  | { ok: false; reason: string };

type IrImage = DocxIrImageRun | DocxIrDrawingPicture;

interface Blip {
  /** The relationship the blip embeds. */
  embed: string;
  /** The SVG an `asvg:svgBlip` extension carries, when the blip is a fallback. */
  svgEmbed?: string;
}

const HEADER_FOOTER_TYPES = ['default', 'first', 'even'] as const;

/** Build the manifest for `buffer`, rendered from `ir`. */
export function buildRenderManifest(
  buffer: Buffer,
  ir: DocxIR,
  imageOrigins: ImageOrigins,
  sourceOrigins: SourceOrigins = new Map()
): RenderManifestBuild {
  try {
    return {
      ok: true,
      manifest: collect(buffer, ir, imageOrigins, sourceOrigins),
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function collect(
  buffer: Buffer,
  ir: DocxIR,
  imageOrigins: ImageOrigins,
  sourceOrigins: SourceOrigins
): RenderManifest {
  const zip = new AdmZip(buffer);
  const read = (entry: string): string | undefined =>
    zip.getEntry(entry)?.getData().toString('utf8');
  const media = new Map<string, string>();
  const mediaHash = (path: string): string => {
    let hash = media.get(path);
    if (hash === undefined) {
      const entry = zip.getEntry(path);
      if (!entry) throw new Error(`the package has no ${path}`);
      hash = sha256Hex(new Uint8Array(entry.getData()));
      media.set(path, hash);
    }
    return hash;
  };
  const resources = new Map(ir.resources.map((r) => [r.id, r]));

  const manifest: RenderManifest = [];
  const pair = (
    part: RenderManifestPart,
    partPath: string,
    xml: string,
    images: IrImage[]
  ): void => {
    const rels = relationships(read(relsPathOf(partPath)), partPath);
    const blips = readBlips(xml);
    if (blips.length !== images.length) {
      throw new Error(
        `${partPath} embeds ${blips.length} image(s) where the IR placed ${images.length}`
      );
    }
    blips.forEach((blip, index) => {
      const image = images[index];
      const mediaPath = target(rels, blip.embed, partPath);
      const sha256 = mediaHash(mediaPath);
      const resource = resources.get(image.resourceId);
      if (
        !resource ||
        !matchesResource(resource, blip, sha256, rels, partPath, mediaHash)
      ) {
        throw new Error(
          `image ${index + 1} of ${partPath} (${mediaPath}) does not hold the bytes of IR resource ${image.resourceId}`
        );
      }
      const origin = imageOrigins.get(image);
      if (!origin) {
        throw new Error(
          `image ${index + 1} of ${partPath} has no standard-definition origin`
        );
      }
      const source = sourceOriginOf(origin.standardPath, sourceOrigins);
      manifest.push({
        part,
        partPath,
        mediaPath,
        sha256,
        standardPath: origin.standardPath,
        kind: origin.kind,
        ...(source && {
          sourcePath: source.sourcePath,
          sourceKind: source.sourceKind,
        }),
      });
    });
  };

  const documentPath = 'word/document.xml';
  const documentXml = read(documentPath);
  if (documentXml === undefined)
    throw new Error(`the package has no ${documentPath}`);
  pair(
    'body',
    documentPath,
    documentXml,
    ir.sections.flatMap((section) => blockImages(section.children))
  );

  // Each layout section writes its own header and footer parts, referenced
  // from its `w:sectPr`; the IR holds the same sections in the same order.
  const sectPrs = sectionProperties(documentXml);
  if (sectPrs.length !== ir.sections.length) {
    throw new Error(
      `${documentPath} has ${sectPrs.length} section(s) where the IR has ${ir.sections.length}`
    );
  }
  const documentRels = relationships(
    read(relsPathOf(documentPath)),
    documentPath
  );
  const seen = new Set<string>();
  ir.sections.forEach((section, index) => {
    const references = chromeReferences(sectPrs[index]);
    for (const part of ['header', 'footer'] as const) {
      const set: DocxIrHeaderFooterSet | undefined =
        part === 'header' ? section.headers : section.footers;
      for (const type of HEADER_FOOTER_TYPES) {
        const id = references.get(`${part}:${type}`);
        if (id === undefined) continue;
        const partPath = target(documentRels, id, documentPath);
        if (seen.has(partPath)) continue;
        seen.add(partPath);
        const xml = read(partPath);
        if (xml === undefined)
          throw new Error(`the package has no ${partPath}`);
        pair(part, partPath, xml, blockImages(set?.[type]?.children ?? []));
      }
    }
  });

  return manifest;
}

/** The nearest recorded ancestor-or-self of `standardPath`. */
function sourceOriginOf(
  standardPath: string,
  sourceOrigins: SourceOrigins
): SourceOrigin | undefined {
  if (sourceOrigins.size === 0) return undefined;
  const segments = standardPath.split('.');
  for (let n = segments.length; n > 0; n--) {
    const hit = sourceOrigins.get(segments.slice(0, n).join('.'));
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Whether the blip embeds the resource's bytes. A vector resource is drawn
 * through a raster fallback the backend makes at the placed size, so there it
 * is the SVG the blip's extension carries that has to match.
 */
function matchesResource(
  resource: DocxIrResource,
  blip: Blip,
  sha256: string,
  rels: ReadonlyMap<string, string>,
  partPath: string,
  mediaHash: (path: string) => string
): boolean {
  if (sha256 === resource.sha256) return true;
  if (resource.mediaType !== 'svg' || blip.svgEmbed === undefined) return false;
  return mediaHash(target(rels, blip.svgEmbed, partPath)) === resource.sha256;
}

/* ------------------------------------------------------------------ *
 * IR walk — the order a backend writes runs in
 * ------------------------------------------------------------------ */

function blockImages(blocks: readonly DocxIrBlock[]): IrImage[] {
  const out: IrImage[] = [];
  const visitBlocks = (items: readonly DocxIrBlock[]): void => {
    for (const block of items) {
      if (block.kind === 'paragraph') visitParagraph(block);
      else if (block.kind === 'table') {
        for (const row of block.rows) {
          for (const cell of row.cells) visitBlocks(cell.children);
        }
      }
    }
  };
  const visitParagraph = (paragraph: DocxIrParagraph): void =>
    visitInlines(paragraph.children);
  const visitInlines = (inlines: readonly DocxIrInline[]): void => {
    for (const inline of inlines) {
      switch (inline.kind) {
        case 'image':
          out.push(inline);
          break;
        case 'drawingGroup':
          for (const child of inline.children) {
            if (child.kind === 'picture') out.push(child);
          }
          break;
        case 'shape':
          inline.children.forEach(visitParagraph);
          break;
        case 'hyperlink':
        case 'revision':
          visitInlines(inline.children);
          break;
        default:
          break;
      }
    }
  };
  visitBlocks(blocks);
  return out;
}

/* ------------------------------------------------------------------ *
 * Package reading
 * ------------------------------------------------------------------ */

/**
 * The blips of one part, in document order. A Markup Compatibility fallback
 * repeats its choice's drawing for older readers; only the choice is counted.
 */
function readBlips(xml: string): Blip[] {
  const body = xml.replace(/<mc:Fallback\b[\s\S]*?<\/mc:Fallback>/g, '');
  const blips: Blip[] = [];
  const pattern = /<a:blip\b([^>]*?)(?:\/>|>([\s\S]*?)<\/a:blip>)/g;
  for (const match of body.matchAll(pattern)) {
    const embed = /\br:embed="([^"]+)"/.exec(match[1])?.[1];
    if (embed === undefined) continue;
    const svgEmbed = match[2]
      ? /<asvg:svgBlip\b[^>]*\br:embed="([^"]+)"/.exec(match[2])?.[1]
      : undefined;
    blips.push(svgEmbed === undefined ? { embed } : { embed, svgEmbed });
  }
  return blips;
}

/** Every `w:sectPr` of the document, in order: one per layout section. */
function sectionProperties(xml: string): string[] {
  return [...xml.matchAll(/<w:sectPr\b(?:[^>]*\/>|[\s\S]*?<\/w:sectPr>)/g)].map(
    (m) => m[0]
  );
}

/** A section's header and footer references, keyed `header:default` and so on. */
function chromeReferences(sectPr: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of sectPr.matchAll(
    /<w:(header|footer)Reference\b([^>]*)\/?>/g
  )) {
    const type = attribute(match[2], 'w:type') ?? 'default';
    const id = attribute(match[2], 'r:id');
    if (id !== undefined) out.set(`${match[1]}:${type}`, id);
  }
  return out;
}

function relsPathOf(partPath: string): string {
  return posix.join(
    posix.dirname(partPath),
    '_rels',
    `${posix.basename(partPath)}.rels`
  );
}

/** A part's relationships, id to raw target. */
function relationships(
  xml: string | undefined,
  partPath: string
): Map<string, string> {
  const out = new Map<string, string>();
  if (xml === undefined) return out;
  for (const match of xml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = attribute(match[1], 'Id');
    const target = attribute(match[1], 'Target');
    if (id !== undefined && target !== undefined) out.set(id, target);
  }
  if (out.size === 0 && /<Relationship\b/.test(xml)) {
    throw new Error(`the relationships of ${partPath} could not be read`);
  }
  return out;
}

/** The package path a relationship of `partPath` points at. */
function target(
  rels: ReadonlyMap<string, string>,
  id: string,
  partPath: string
): string {
  const raw = rels.get(id);
  if (raw === undefined) {
    throw new Error(`${partPath} references an unknown relationship ${id}`);
  }
  return raw.startsWith('/')
    ? raw.slice(1)
    : posix.normalize(posix.join(posix.dirname(partPath), raw));
}

function attribute(attributes: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\s)${escaped}="([^"]*)"`).exec(attributes)?.[1];
}
