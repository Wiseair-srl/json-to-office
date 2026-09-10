import { type JsonPatchOperation, type QualityRuleFinding } from './types';

/**
 * Type consistency shared by both formats: whether a size is one the theme
 * paints, how many sizes reach the page, and whether one role is painted at
 * two of them.
 *
 * The questions are the same in a report and a deck, and only the vocabulary
 * differs — a DOCX role is a paragraph style or a heading level and lives on
 * a page, a PPTX one is a named style or a type role and lives on a slide. So
 * each format's fact builder supplies the sizes it painted and the words its
 * authors use, and the logic below is written once.
 */

/** One painted size, wherever a format paints it. */
export interface PaintedSize {
  /** Where the size reaches the page; a finding without a patch lands here. */
  path: string;
  /** The style, heading level or type role the size belongs to. */
  role?: string;
  fontSizePt: number;
  /** The authored size value — the only thing a fix can replace. */
  sizePath?: string;
  /** A block compiled this node, so its pointer is not the author's to patch. */
  generated?: boolean;
}

/**
 * How each format words what it paints, so one message reads naturally in
 * both. Only the prose differs: `role` stays the key on `context` and
 * `evidence.values`, because a consumer reading either should not have to
 * know which format wrote it.
 */
export interface TypeVocabulary {
  /** `document` or `deck`. */
  subject: string;
  /** What to keep to instead: the theme's own list of styles. */
  keepTo: string;
}

export const SIZE_TOLERANCE_PT = 0.25;

const near = (a: number, b: number): boolean =>
  Math.abs(a - b) <= SIZE_TOLERANCE_PT;

/** Authored, patchable sizes: the ones a fix can move. */
const patchable = (sizes: readonly PaintedSize[]): readonly PaintedSize[] =>
  sizes.filter((size) => size.sizePath !== undefined && !size.generated);

/**
 * The sizes `roleDriftFindings` reports: authored, and away from the theme's
 * size for a role that is painted at more than one. The off-scale rule leaves
 * these alone so the two never offer two different sizes for one pointer.
 */
export function driftingSizes(
  sizes: readonly PaintedSize[],
  roleSizesPt: Readonly<Record<string, number>>
): Map<PaintedSize, { expected: number; sizes: number[] }> {
  const byRole = new Map<string, PaintedSize[]>();
  for (const size of sizes) {
    if (size.role === undefined) continue;
    byRole.set(size.role, [...(byRole.get(size.role) ?? []), size]);
  }
  const drifting = new Map<
    PaintedSize,
    { expected: number; sizes: number[] }
  >();
  for (const [role, members] of byRole) {
    const painted = [...new Set(members.map((m) => m.fontSizePt))].sort(
      (a, b) => a - b
    );
    if (painted.length < 2) continue;
    const expected = roleSizesPt[role];
    if (expected === undefined) continue;
    for (const member of patchable(members))
      if (!near(member.fontSizePt, expected))
        drifting.set(member, { expected, sizes: painted });
  }
  return drifting;
}

function nearestSize(size: number, scale: readonly number[]): number {
  let best = scale[0];
  for (const candidate of scale)
    if (Math.abs(candidate - size) < Math.abs(best - size)) best = candidate;
  return best;
}

/** An authored size the theme never paints, one finding per role and size. */
export function offScaleFindings(
  sizes: readonly PaintedSize[],
  scale: readonly number[],
  themeName: string,
  vocabulary: TypeVocabulary,
  drifting: ReadonlyMap<PaintedSize, unknown> = new Map()
): QualityRuleFinding[] {
  if (scale.length === 0) return [];
  const offScale = patchable(sizes).filter(
    (size) =>
      !drifting.has(size) && !scale.some((step) => near(step, size.fontSizePt))
  );
  // One finding per role and size, patching every pointer together: snapping
  // one place of a consistently sized role on its own would leave the role at
  // two sizes, and trade this finding for a drift one.
  const groups = new Map<string, PaintedSize[]>();
  for (const size of offScale) {
    const key = `${size.role ?? ''}@${size.fontSizePt}`;
    groups.set(key, [...(groups.get(key) ?? []), size]);
  }
  return [...groups.values()].map((members) => {
    const [first] = members;
    const nearest = nearestSize(first.fontSizePt, scale);
    const sizePaths = members.map((member) => member.sizePath!);
    const count =
      members.length === 1
        ? ''
        : ` (${members.length} places, patched together)`;
    const role = first.role ?? `the ${vocabulary.subject} default`;
    return {
      path: sizePaths[0],
      ...(sizePaths.length > 1 && { relatedPaths: sizePaths.slice(1) }),
      message:
        `${first.fontSizePt}pt is not a size the ${themeName} theme paints; ` +
        `the nearest on its scale is ${nearest}pt${count}.`,
      suggestion: `Use ${nearest}pt, or drop the size and let "${role}" set it.`,
      context: { role: first.role, scale, paths: sizePaths },
      evidence: {
        actual: first.fontSizePt,
        expected: nearest,
        unit: 'pt',
        values: { source: 'theme' },
      },
      fixes: sizePaths.map(
        (path): JsonPatchOperation => ({ op: 'replace', path, value: nearest })
      ),
    };
  });
}

/** How many distinct sizes reach the page, against the profile's ceiling. */
export function sizeCountFinding(
  sizes: readonly PaintedSize[],
  maximum: number,
  themePath: string,
  profileId: string | undefined,
  vocabulary: TypeVocabulary
): QualityRuleFinding[] {
  const firstPathBySize = new Map<number, string>();
  for (const size of sizes) {
    const rounded = Math.round(size.fontSizePt * 4) / 4;
    if (!firstPathBySize.has(rounded)) firstPathBySize.set(rounded, size.path);
  }
  if (firstPathBySize.size <= maximum) return [];
  const painted = [...firstPathBySize.keys()].sort((a, b) => a - b);
  return [
    {
      path: themePath,
      relatedPaths: painted.map((size) => firstPathBySize.get(size)!),
      message:
        `The ${vocabulary.subject} paints ${painted.length} distinct text sizes ` +
        `(${painted.join(', ')}pt); the ${profileId ?? 'selected'} profile allows ${maximum}.`,
      suggestion: vocabulary.keepTo,
      context: { sizes: painted, maximum },
      evidence: {
        actual: painted.length,
        expected: maximum,
        values: { source: 'profile' },
      },
    },
  ];
}

/** One role at two sizes, repaired to the size the theme sets for it. */
export function roleDriftFindings(
  sizes: readonly PaintedSize[],
  roleSizesPt: Readonly<Record<string, number>>
): QualityRuleFinding[] {
  const findings: QualityRuleFinding[] = [];
  for (const [size, { expected, sizes: painted }] of driftingSizes(
    sizes,
    roleSizesPt
  )) {
    const keeper = sizes.find(
      (member) => member.role === size.role && near(member.fontSizePt, expected)
    );
    const others = painted.filter((value) => value !== size.fontSizePt);
    const sizePath = size.sizePath!;
    findings.push({
      path: sizePath,
      ...(keeper && { relatedPaths: [keeper.path] }),
      message:
        `"${size.role}" is painted at ${size.fontSizePt}pt here and at ` +
        `${others.join('pt, ')}pt elsewhere; the theme sets it at ${expected}pt.`,
      suggestion: `Drop the size so "${size.role}" paints at the theme's ${expected}pt.`,
      context: { role: size.role, sizes: painted },
      evidence: {
        actual: size.fontSizePt,
        expected,
        unit: 'pt',
        values: { role: size.role, source: 'theme' },
      },
      fixes: [{ op: 'replace', path: sizePath, value: expected }],
    });
  }
  return findings;
}
