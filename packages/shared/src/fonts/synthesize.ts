/**
 * Map a (family, weight, italic) tuple to the pair of
 * `(familyName, { bold, italic })` the renderer should actually use.
 *
 * OOXML runs can only carry a bold/italic toggle, not a numeric weight.
 * For weights outside the RIBBI quad (400/700 × roman/italic), Word
 * resolves intermediate weights via **separate sub-family faces** whose
 * internal family name is the canonical Google-Fonts-style subfamily,
 * e.g. `Inter Light`, `Inter ExtraBold Italic`. Rewriting the run's
 * `family` to that synthetic name lets Word pick the right face when the
 * recipient has the full family installed, and lets the LibreOffice
 * preview resolve the matching staged TTF by its internal name.
 *
 * No embedding involved — this is purely a name transform applied at
 * render time. Safe fonts and unrecognised weights fall back to the
 * bold-only heuristic (`weight >= 600 → bold`).
 */

/** Human-readable labels for the canonical font-weight numbers. */
export const WEIGHT_LABELS: Record<number, string> = {
  100: 'Thin',
  200: 'ExtraLight',
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'SemiBold',
  700: 'Bold',
  800: 'ExtraBold',
  900: 'Black',
};

export interface SynthesizedFamily {
  /** The family name to emit in `rFonts`/`fontFace`. */
  family: string;
  /** Whether to also set the run's bold toggle. */
  bold: boolean;
  /** Whether to also set the run's italic toggle. */
  italic: boolean;
  /**
   * `true` when the input `weight` was not one of the canonical
   * 100/200/.../900 labels. The canonical family name is returned with
   * a `weight >= 600 → bold` fallback, but the run will not match a
   * dedicated sub-family face — callers should surface this so authors
   * know the weight was effectively rounded to Regular or Bold.
   */
  nonCanonicalWeight: boolean;
}

/**
 * Translate `(family, weight, italic)` into the rendering-time family name
 * plus the bold/italic toggles to emit on the run.
 *
 * - RIBBI (weights 400 + 700, roman + italic) stays on the canonical family
 *   name and uses native bold/italic toggles.
 * - Other canonical weights become `"<Family> <Weight>"` (e.g.
 *   `"Inter Light"`) with bold/italic toggles cleared; any italic flag is
 *   folded into the name (`"Inter Light Italic"`).
 * - Non-canonical weights (floating or out-of-range) fall back to
 *   `bold = weight >= 600` and leave the family name untouched.
 */
export function synthesizeFamilyName(
  family: string,
  weight: number | undefined,
  italic: boolean
): SynthesizedFamily {
  if (weight == null) {
    return { family, bold: false, italic, nonCanonicalWeight: false };
  }
  // RIBBI — no rewrite needed, let native bold/italic do the work.
  if (weight === 400) {
    return { family, bold: false, italic, nonCanonicalWeight: false };
  }
  if (weight === 700) {
    return { family, bold: true, italic, nonCanonicalWeight: false };
  }
  const label = WEIGHT_LABELS[weight];
  if (!label) {
    // Non-canonical weight — best-effort bold fallback. Flag the result so
    // callers can warn: the run will render as Regular or Bold, not the
    // intermediate weight the author asked for.
    return {
      family,
      bold: weight >= 600,
      italic,
      nonCanonicalWeight: true,
    };
  }
  const suffix = italic ? ` ${label} Italic` : ` ${label}`;
  return {
    family: `${family}${suffix}`,
    bold: false,
    italic: false,
    nonCanonicalWeight: false,
  };
}
