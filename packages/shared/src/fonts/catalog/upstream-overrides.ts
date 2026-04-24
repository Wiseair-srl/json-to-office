/**
 * Per-family upstream overrides for popular Google Fonts whose
 * redistribution on fonts.google.com has known defects we can't fix via
 * metadata patching alone.
 *
 * When `autoGoogleFontEntries` hits a family present in this table, it
 * builds override sources instead of issuing `kind: "google"` CSS requests.
 * Each entry is either:
 *
 *   - `{ kind: "url", url, weight, italic? }` — a direct HTTPS TTF/OTF.
 *     Use when a clean per-weight static exists on a stable CDN.
 *
 *   - `{ kind: "variable", url, weight, italic? }` — points at a variable
 *     TTF with an `fvar` table. The registry downloads the variable font
 *     once and harfbuzz-pins the `wght` axis to the specified weight,
 *     producing a clean static TTF. Use when the upstream ships a variable
 *     font but no per-weight statics on a CDN (rsms/inter is the
 *     canonical example — variable font on jsDelivr, per-weight statics
 *     only in GitHub release zips).
 *
 * Pick `variable` over `url` when both are available: the instancer
 * produces per-weight glyph outlines that diverge correctly at every
 * axis value. Google's static redistributions collapse adjacent weights
 * onto the same instance — Inter Thin and ExtraLight both source at
 * ~wght=250 in Google's pipeline, so their static TTFs have 98% identical
 * glyph outlines. Instancing the upstream variable font at exactly wght=100
 * vs wght=200 gives properly distinct geometry.
 *
 * Validate new entries with a HEAD request before adding — the fetchers
 * reject non-TTF responses, but a failed override silently falls back to
 * the Google path, defeating the purpose.
 */

/** One upstream variant source. Type matches the FontSource schema so we
 *  can pass the entry directly into `FontRegistry`'s materialize pipeline. */
export type UpstreamVariant =
  | {
      kind: 'url';
      url: string;
      weight: number;
      italic?: boolean;
    }
  | {
      kind: 'variable';
      url: string;
      weight: number;
      italic?: boolean;
      /** Extra axis pins merged on top of the derived `wght` pin. */
      axes?: Record<string, number>;
    };

export interface UpstreamOverride {
  /** Human-readable for logs/diagnostics only. */
  reason: string;
  variants: UpstreamVariant[];
}

/**
 * rsms/inter ships `InterVariable.ttf` (the upright variable font) and
 * `InterVariable-Italic.ttf` on jsDelivr. We instance the upright at each
 * advertised weight so Inter Thin (100), ExtraLight (200), Light (300),
 * Medium (500), SemiBold (600), ExtraBold (800), and Black (900) come out
 * with distinct glyph outlines instead of the near-duplicates Google's
 * static redistribution ships. Regular (400) and Bold (700) from Google
 * were already clean, but instancing them from the same variable font
 * keeps the full family visually consistent.
 *
 * Version pin: `@v4.1` — the last stable rsms/inter release at the time
 * of writing. jsDelivr caches the file aggressively; a version bump here
 * invalidates that cache for users on a subsequent generate.
 */
const INTER_VARIABLE_URL =
  'https://cdn.jsdelivr.net/gh/rsms/inter@v4.1/docs/font-files/InterVariable.ttf';
const INTER_VARIABLE_ITALIC_URL =
  'https://cdn.jsdelivr.net/gh/rsms/inter@v4.1/docs/font-files/InterVariable-Italic.ttf';

function interVariants(): UpstreamVariant[] {
  const weights = [100, 200, 300, 400, 500, 600, 700, 800, 900];
  const upright = weights.map((weight) => ({
    kind: 'variable' as const,
    url: INTER_VARIABLE_URL,
    weight,
    italic: false,
  }));
  const italic = weights.map((weight) => ({
    kind: 'variable' as const,
    url: INTER_VARIABLE_ITALIC_URL,
    weight,
    italic: true,
  }));
  return [...upright, ...italic];
}

export const UPSTREAM_OVERRIDES: Record<string, UpstreamOverride> = {
  inter: {
    reason:
      "Google's static Inter Thin/ExtraLight both carry usWeightClass=250 and near-identical glyph outlines (xAvgCharWidth differs by 1.8%); instancing the upstream variable font per weight produces properly distinct statics.",
    variants: interVariants(),
  },
};

/** Case-insensitive lookup. Returns undefined when the family has no override. */
export function getUpstreamOverride(
  family: string
): UpstreamOverride | undefined {
  return UPSTREAM_OVERRIDES[family.toLowerCase()];
}
