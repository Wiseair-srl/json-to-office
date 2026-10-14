/**
 * `ResolvedFont[]` → the faces the `embed` export mode writes into a DOCX.
 *
 * Word's font table has four slots per family — `w:embedRegular`,
 * `w:embedBold`, `w:embedItalic`, `w:embedBoldItalic` — and a run selects
 * among them with nothing but its bold and italic toggles. A resolved family
 * can carry any number of weights, so this is where the two are reconciled:
 * which source fills which slot, which sources fill none, and which may not
 * be embedded at all. The renderer only ever sees the result; it never has to
 * know about weights, formats or licences.
 *
 * Weights outside the four slots are NOT embedded, even though the bytes are
 * in hand. Word for Mac silently substitutes a face it cannot address by
 * family + bold/italic, and that failure is what got embedding pulled from
 * jto once already. A run at such a weight references the synthesised
 * sub-family ("Inter Light", see `synthesizeFamilyName`) exactly as in
 * `custom` mode, and the warning says so.
 *
 * Buffer-dependent → Node-only. Exported from `@json-to-office/shared/fonts/node`.
 */

import type {
  EmbeddedFontFace,
  ResolvedFont,
  ResolvedFontSource,
} from './types';
import type { GenerationWarning } from '../types/warnings';
import { isSafeFont } from '../schemas/font-catalog';
import { readFontFsType } from './sources/ttf-validate';
import { synthesizeFamilyName } from './synthesize';

export type { EmbeddedFontFace };

export type EmbeddedFontSlot = 'regular' | 'bold' | 'italic' | 'boldItalic';

/** What happened to one non-safe family that had sources to choose from. */
export interface EmbeddedFontFamilyReport {
  family: string;
  /** The slots that embed, in Word's order. Empty when nothing of it embeds. */
  slots: EmbeddedFontSlot[];
  /** Slots filled from the nearest weight on their side, not 400 or 700. */
  nearest: Array<{ slot: EmbeddedFontSlot; weight: number }>;
  /**
   * Why nothing of the family embeds, when `slots` is empty. docx.js needs the
   * regular face before it will write any other, so a family without one
   * embeds nothing at all.
   */
  reason?: 'no-embeddable-face' | 'no-regular-face';
}

export interface EmbeddedFontSelection {
  faces: EmbeddedFontFace[];
  /** One entry per non-safe family with sources, in resolution order. */
  report: EmbeddedFontFamilyReport[];
}

/**
 * The formats OOXML carries. ECMA-376 obfuscates and embeds TrueType and
 * OpenType files; WOFF and WOFF2 are web wrappers no Office reader unwraps,
 * and EOT and Type 1 are neither. An allowlist rather than a denylist, so a
 * format added to `ResolvedFontSource['format']` later stays out until
 * someone decides it belongs.
 */
const EMBEDDABLE_FORMATS = new Set<ResolvedFontSource['format']>([
  'ttf',
  'otf',
]);

/**
 * Word's four slots, in the order docx.js numbers the files. Each takes its
 * canonical weight, else the nearest one on the same side of the
 * regular/bold divide: a family shipped as Medium + SemiBold still gets a
 * regular and a bold, rather than nothing. Further than that is no longer
 * the face the author picked.
 */
const SLOTS: ReadonlyArray<{
  slot: EmbeddedFontSlot;
  label: string;
  italic: boolean;
  weights: readonly [number, number];
}> = [
  { slot: 'regular', label: 'regular', italic: false, weights: [400, 500] },
  { slot: 'bold', label: 'bold', italic: false, weights: [700, 600] },
  { slot: 'italic', label: 'italic', italic: true, weights: [400, 500] },
  {
    slot: 'boldItalic',
    label: 'bold italic',
    italic: true,
    weights: [700, 600],
  },
];

type Licence = 'installable' | 'editable' | 'preview-print' | 'restricted';

/**
 * The embedding licence `OS/2.fsType` grants. A font may set several of the
 * bits; the OpenType spec says the least restrictive one present applies,
 * hence the order. Bit 8 (no subsetting) and bit 9 (bitmap only) are not
 * consulted: the whole file is embedded, outlines and all.
 */
function embeddingLicence(fsType: number): Licence {
  if (fsType & 0x0008) return 'editable';
  if (fsType & 0x0004) return 'preview-print';
  if (fsType & 0x0002) return 'restricted';
  return 'installable';
}

interface Candidate {
  source: ResolvedFontSource;
  fsType: number;
  licence: Licence;
}

const hex = (fsType: number): string =>
  `0x${fsType.toString(16).padStart(4, '0')}`;

/**
 * Pick, per non-safe family, the faces that fill Word's four slots.
 *
 * Safe families are skipped silently: every reader has them, and a registry
 * entry that ships bytes for one does not change that. So are families with
 * no sources at all — an unresolved reference has nothing to embed, and the
 * resolver has already warned about it.
 *
 * @param warnings - sink for one warning per face that does not embed as
 *   asked (format, licence, no slot) or embeds with a consequence (read-only),
 *   shaped like every other font warning. The per-family summary is left to
 *   the caller, which knows what the document references.
 */
export function toEmbeddedFontFaces(
  fonts: readonly ResolvedFont[],
  warnings?: GenerationWarning[]
): EmbeddedFontSelection {
  const faces: EmbeddedFontFace[] = [];
  const report: EmbeddedFontFamilyReport[] = [];
  const warn = (code: string, message: string) =>
    warnings?.push({
      component: 'fontRegistry',
      severity: 'warning',
      context: { code },
      message,
    });
  // A family referenced by both its id and its name resolves twice, to the
  // same sources; docx.js would write two `w:font` entries for it.
  const seen = new Set<string>();

  for (const font of fonts) {
    if (font.sources.length === 0 || isSafeFont(font.family)) continue;
    const key = font.family.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const face = (source: ResolvedFontSource) =>
      `"${font.family}" weight ${source.weight}${source.italic ? ' italic' : ''}`;

    // Format and licence first, so a face that may not embed never takes a
    // slot a face that may would have filled.
    const candidates: Candidate[] = [];
    for (const source of font.sources) {
      if (!EMBEDDABLE_FORMATS.has(source.format)) {
        warn(
          'FONT_EMBED_SKIPPED_FORMAT',
          `${face(source)} is ${source.format}; a Word document embeds only ` +
            `TrueType or OpenType files, so this face is not embedded and a ` +
            `reader without the font sees a fallback for it.`
        );
        continue;
      }
      // No readable OS/2 table claims no restriction.
      const fsType = readFontFsType(source.data) ?? 0;
      const licence = embeddingLicence(fsType);
      if (licence === 'restricted') {
        warn(
          'FONT_EMBED_SKIPPED_LICENSE',
          `${face(source)}: its licence forbids embedding (OS/2.fsType ` +
            `${hex(fsType)}, restricted), so this face is not embedded and a ` +
            `reader without the font sees a fallback for it.`
        );
        continue;
      }
      candidates.push({ source, fsType, licence });
    }

    const filled = new Map<EmbeddedFontSlot, Candidate>();
    for (const { slot, italic, weights } of SLOTS) {
      for (const weight of weights) {
        const pick = candidates.find(
          (c) => c.source.italic === italic && c.source.weight === weight
        );
        if (pick) {
          filled.set(slot, pick);
          break;
        }
      }
    }
    const picked = new Set(filled.values());
    const regular = filled.get('regular');

    for (const candidate of candidates) {
      if (regular && picked.has(candidate)) continue;
      const { source } = candidate;
      let why: string;
      if (!regular) {
        why =
          `a family's other faces embed only beside its regular one ` +
          `(upright, weight 400 or else 500), and "${font.family}" has none ` +
          `it may embed`;
      } else {
        const own = SLOTS.find(
          (s) => s.italic === source.italic && s.weights.includes(source.weight)
        );
        const holder = own && filled.get(own.slot);
        why = holder
          ? `the ${own.label} slot is already filled by ` +
            (holder.source.weight === source.weight
              ? `another weight ${source.weight} source`
              : `weight ${holder.source.weight}`)
          : `Word embeds four faces per family (regular, bold, italic, ` +
            `bold italic) and this one fills none of them`;
      }
      // A RIBBI weight is referenced by the family's own name and its run
      // toggles; any other by a sub-family name of its own, which this
      // document does not carry.
      const reference = synthesizeFamilyName(
        font.family,
        source.weight,
        source.italic
      ).family;
      warn(
        'FONT_EMBED_WEIGHT_DROPPED',
        `${face(source)} is not embedded: ${why}. ` +
          (reference !== font.family
            ? `A run at that weight keeps its reference to "${reference}", ` +
              `as in custom mode, and a reader without the font sees a ` +
              `fallback for it.`
            : `Its reference stays as authored, as in custom mode.`)
      );
    }

    if (!regular) {
      report.push({
        family: font.family,
        slots: [],
        nearest: [],
        reason:
          candidates.length === 0 ? 'no-embeddable-face' : 'no-regular-face',
      });
      continue;
    }

    const embedded: EmbeddedFontFace = {
      family: font.family,
      regular: regular.source.data,
    };
    const entry: EmbeddedFontFamilyReport = {
      family: font.family,
      slots: [],
      nearest: [],
    };
    for (const { slot, weights } of SLOTS) {
      const candidate = filled.get(slot);
      if (!candidate) continue;
      embedded[slot] = candidate.source.data;
      entry.slots.push(slot);
      if (candidate.source.weight !== weights[0]) {
        entry.nearest.push({ slot, weight: candidate.source.weight });
      }
      if (candidate.licence === 'preview-print') {
        warn(
          'FONT_EMBED_READ_ONLY',
          `${face(candidate.source)} is embedded under a preview & print ` +
            `licence (OS/2.fsType ${hex(candidate.fsType)}): Word opens the ` +
            `document read-only.`
        );
      }
    }
    faces.push(embedded);
    report.push(entry);
  }

  return { faces, report };
}
