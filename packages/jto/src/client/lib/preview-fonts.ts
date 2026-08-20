/**
 * Build the `@font-face` block for the fast in-browser DOCX preview.
 *
 * The generated .docx never carries font bytes (`word/fonts/` is always
 * empty — see core-docx's no-font-embedding regression suite), so
 * docx-preview's own `renderFontTable` contributes nothing and the preview
 * silently renders in whatever the host machine happens to have. We
 * synthesize the faces instead, from the document's `fontRegistry` plus the
 * bundled Google catalog.
 *
 * The load-bearing subtlety is weight. core-docx rewrites runs through
 * `synthesizeFamilyName`, so `{ family: 'Inter', fontWeight: 300 }` reaches
 * the preview as the family literal `"Inter Light"` with no bold toggle,
 * while docx-preview only ever emits `font-weight: bold | normal`. A face
 * registered as `Inter` at weight 300 would therefore never be selected —
 * every non-RIBBI weight needs a second rule under its synthetic sub-family
 * name at plain 400/normal. Google's own stylesheet declares only
 * `font-family: 'Inter'`, which is why the Google path fetches and rewrites
 * the CSS rather than just linking it.
 *
 * Kept free of DOM access so it is unit-testable — packages/jto runs vitest
 * with the default `node` environment. render.ts owns the DOM glue.
 */

import {
  WEIGHT_LABELS,
  POPULAR_GOOGLE_FONTS,
  isSafeFont,
  isAllowedFontUrl,
  collectFontNamesFromDocx,
  type FontRegistryEntry,
} from '@json-to-office/shared';

/** One resolved face, before expansion to synthetic sub-family names. */
export interface PreviewFontFace {
  family: string;
  weight: number;
  italic: boolean;
  /** Full CSS `src` value, e.g. `url("https://…woff2")`. */
  src: string;
  unicodeRange?: string;
  /** Backed by a variable font, so synthetic names must pin the wght axis. */
  variable?: boolean;
}

export interface PreviewFontAssets {
  css: string;
  /** Fallback `<link rel=stylesheet>` hrefs when CSS rewriting failed. */
  googleHrefs: string[];
}

/** Cap on generated CSS — it ends up inside an HTML `srcdoc` attribute. */
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

function asArray(v: unknown): FontRegistryEntry[] {
  return Array.isArray(v) ? (v as FontRegistryEntry[]) : [];
}

/**
 * Collect registry entries from the document and any custom themes.
 * Document entries win, mirroring the server's precedence where
 * caller-supplied entries beat theme-declared ones.
 */
export function extractFontRegistries(
  jsonText: string | undefined,
  customThemes: Record<string, unknown> | undefined
): FontRegistryEntry[] {
  let docEntries: FontRegistryEntry[] = [];
  if (typeof jsonText === 'string' && jsonText.length > 0) {
    try {
      const parsed = JSON.parse(jsonText) as {
        props?: { fontRegistry?: unknown };
      };
      docEntries = asArray(parsed?.props?.fontRegistry);
    } catch {
      // A mid-edit document is not valid JSON. The preview gets no registry
      // fonts rather than failing to render.
      return [];
    }
  }

  const themeEntries: FontRegistryEntry[] = [];
  for (const theme of Object.values(customThemes ?? {})) {
    themeEntries.push(
      ...asArray((theme as { fontRegistry?: unknown })?.fontRegistry)
    );
  }

  const byFamily = new Map<string, FontRegistryEntry>();
  for (const e of [...themeEntries, ...docEntries]) {
    if (e && typeof e.family === 'string') {
      byFamily.set(e.family.toLowerCase(), e);
    }
  }
  return [...byFamily.values()];
}

/**
 * The family names a run may actually carry for a given weight, mirroring
 * `synthesizeFamilyName`.
 *
 * Weight 400/700 keep the canonical name and rely on docx-preview's
 * bold/normal toggle. Other canonical weights arrive as a synthetic
 * sub-family carrying no toggle, so their rule must be plain 400/normal.
 */
export function synthesizedFamilyNames(
  family: string,
  weight: number,
  italic: boolean
): { family: string; cssWeight: number; cssStyle: 'normal' | 'italic' }[] {
  const out = [
    {
      family,
      cssWeight: weight,
      cssStyle: (italic ? 'italic' : 'normal') as 'normal' | 'italic',
    },
  ];
  const label = WEIGHT_LABELS[weight];
  if (weight !== 400 && weight !== 700 && label) {
    out.push({
      family: `${family} ${label}${italic ? ' Italic' : ''}`,
      cssWeight: 400,
      cssStyle: 'normal',
    });
  }
  return out;
}

function dataUrlFor(raw: string): string {
  return raw.startsWith('data:') ? raw : `data:font/ttf;base64,${raw}`;
}

/** Turn one registry entry into concrete faces. */
export function facesFromRegistryEntry(
  entry: FontRegistryEntry
): PreviewFontFace[] {
  const faces: PreviewFontFace[] = [];

  for (const source of entry.sources ?? []) {
    // `safe` needs nothing; `file` paths only exist server-side; `google`
    // goes through the fetch-and-rewrite path instead.
    if (
      source.kind === 'safe' ||
      source.kind === 'file' ||
      source.kind === 'google'
    ) {
      continue;
    }

    const italic = 'italic' in source ? Boolean(source.italic) : false;
    const weight = 'weight' in source && source.weight ? source.weight : 400;

    if (source.kind === 'data') {
      // No format() hint: it is advisory, browsers sniff, and the real
      // detector is Buffer-based and unavailable in the browser.
      faces.push({
        family: entry.family,
        weight,
        italic,
        src: `url("${dataUrlFor(source.data)}")`,
      });
      continue;
    }

    // `url` and `variable` both point at a remote file; apply the same host
    // policy the Node fetchers use so a crafted document cannot make the
    // preview reach arbitrary hosts.
    if (!isAllowedFontUrl(source.url)) continue;
    faces.push({
      family: entry.family,
      weight,
      italic,
      src: `url("${source.url}")`,
      variable: source.kind === 'variable',
    });
  }
  return faces;
}

/** Google catalog families referenced by the document. */
export function googleFamiliesFor(
  referencedNames: Set<string>,
  registryEntries: FontRegistryEntry[],
  referencedWeights: Set<number>
): { family: string; weights: number[]; italics: boolean }[] {
  // A registry entry backed by real bytes wins over the Google stylesheet.
  const covered = new Set(
    registryEntries
      .filter((e) =>
        (e.sources ?? []).some((s) => s.kind !== 'google' && s.kind !== 'safe')
      )
      .map((e) => e.family.toLowerCase())
  );

  const out: { family: string; weights: number[]; italics: boolean }[] = [];
  const emitted = new Set<string>();

  for (const name of referencedNames) {
    if (isSafeFont(name)) continue;
    const lower = name.toLowerCase();
    if (covered.has(lower) || emitted.has(lower)) continue;
    const match = POPULAR_GOOGLE_FONTS.find(
      (f) => f.family.toLowerCase() === lower
    );
    if (!match) continue;
    emitted.add(lower);

    const wanted = new Set<number>([400, 700, ...referencedWeights]);
    const weights = match.weights.filter((w) => wanted.has(w));
    out.push({
      family: match.family,
      weights: weights.length > 0 ? weights : [400],
      italics: match.hasItalic,
    });
  }
  return out;
}

/**
 * Google's css2 endpoint rejects unsorted axis tuples with a 400, so weights
 * ascend and `ital` tuples are grouped roman-then-italic.
 */
export function buildGoogleCss2Href(
  family: string,
  weights: number[],
  italics: boolean
): string {
  const sorted = [...new Set(weights)].sort((a, b) => a - b);
  const axis = italics
    ? `ital,wght@${[
        ...sorted.map((w) => `0,${w}`),
        ...sorted.map((w) => `1,${w}`),
      ].join(';')}`
    : `wght@${sorted.join(';')}`;
  return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(
    family
  )}:${axis}&display=swap`;
}

/** Parsed Google CSS, memoized per (family, weights, italics). */
const googleFaceCache = new Map<string, Promise<PreviewFontFace[]>>();

/**
 * Fetch a Google stylesheet and re-express it as faces we own.
 *
 * A plain `<link>` would only ever declare `font-family: 'Inter'`, so runs
 * carrying the synthetic `"Inter Light"` name would not match. Parsing the
 * CSS gives us the real gstatic URLs, which `renderFontFaceCss` then re-emits
 * under both the canonical and synthetic names.
 */
export async function fetchGoogleFacesRewritten(
  family: string,
  weights: number[],
  italics: boolean,
  fetchImpl: typeof fetch = fetch
): Promise<PreviewFontFace[]> {
  const href = buildGoogleCss2Href(family, weights, italics);
  const cached = googleFaceCache.get(href);
  if (cached) return cached;

  const pending = (async () => {
    const res = await fetchImpl(href);
    if (!res.ok) throw new Error(`Google Fonts CSS ${res.status}`);
    return parseGoogleCss(await res.text(), family);
  })();

  googleFaceCache.set(href, pending);
  // A failed fetch must not poison the cache for the rest of the session.
  pending.catch(() => googleFaceCache.delete(href));
  return pending;
}

/** Split a Google css2 response into faces. Exported for testing. */
export function parseGoogleCss(css: string, family: string): PreviewFontFace[] {
  const faces: PreviewFontFace[] = [];
  for (const block of css.split('@font-face')) {
    const src = /src:\s*([^;]+);/.exec(block)?.[1]?.trim();
    if (!src) continue;
    const style = /font-style:\s*(\w+)/.exec(block)?.[1] ?? 'normal';
    const weight = Number(/font-weight:\s*(\d+)/.exec(block)?.[1] ?? '400');
    const unicodeRange = /unicode-range:\s*([^;]+);/.exec(block)?.[1]?.trim();
    faces.push({
      family,
      weight: Number.isFinite(weight) ? weight : 400,
      italic: style === 'italic',
      src,
      ...(unicodeRange ? { unicodeRange } : {}),
    });
  }
  return faces;
}

function escapeCssString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Expand faces through `synthesizedFamilyNames` and render the stylesheet.
 * De-dupes identical rules, which matters because a variable source and a
 * Google fallback can legitimately produce the same face twice.
 */
export function renderFontFaceCss(
  faces: PreviewFontFace[],
  maxBytes: number = DEFAULT_MAX_BYTES
): string {
  const seen = new Set<string>();
  const rules: string[] = [];
  let bytes = 0;
  let dropped = 0;

  for (const face of faces) {
    for (const n of synthesizedFamilyNames(
      face.family,
      face.weight,
      face.italic
    )) {
      const key = `${n.family}|${n.cssWeight}|${n.cssStyle}|${face.src}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // A synthetic name carries no weight of its own, so a variable font
      // would render at its default instance without an explicit axis pin.
      const isSynthetic = n.family !== face.family;
      const variation =
        face.variable && isSynthetic
          ? `font-variation-settings:"wght" ${face.weight};`
          : '';

      const rule =
        `@font-face{font-family:"${escapeCssString(n.family)}";` +
        `src:${face.src};` +
        `font-weight:${n.cssWeight};` +
        `font-style:${n.cssStyle};` +
        `font-display:swap;` +
        variation +
        (face.unicodeRange ? `unicode-range:${face.unicodeRange};` : '') +
        `}`;

      if (bytes + rule.length > maxBytes) {
        dropped++;
        continue;
      }
      bytes += rule.length;
      rules.push(rule);
    }
  }

  if (dropped > 0) {
    console.warn(
      `Preview fonts: dropped ${dropped} @font-face rule(s) over the ${maxBytes}-byte budget.`
    );
  }
  return rules.join('\n');
}

/** Collect numeric `fontWeight` values, mirroring the server's walker. */
export function collectReferencedWeights(node: unknown): Set<number> {
  const out = new Set<number>();
  const visit = (n: unknown): void => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) {
      for (const item of n) visit(item);
      return;
    }
    for (const [k, v] of Object.entries(n as Record<string, unknown>)) {
      if (k === 'fontWeight' && typeof v === 'number') out.add(v);
      else visit(v);
    }
  };
  visit(node);
  return out;
}

/**
 * Everything the preview head needs. Registry fonts become inline
 * `@font-face` rules; Google catalog families are fetched and rewritten so
 * synthetic sub-family names resolve, falling back to a plain stylesheet
 * link (which still covers 400/700) if that fetch fails.
 */
export async function buildPreviewFontAssets(
  jsonText: string | undefined,
  customThemes: Record<string, unknown> | undefined,
  opts?: { fetchImpl?: typeof fetch; maxBytes?: number }
): Promise<PreviewFontAssets> {
  const entries = extractFontRegistries(jsonText, customThemes);

  let parsedDoc: unknown;
  if (typeof jsonText === 'string' && jsonText.length > 0) {
    try {
      parsedDoc = JSON.parse(jsonText);
    } catch {
      parsedDoc = undefined;
    }
  }

  // Union the document and every custom theme, the same way the server's
  // collectReferencedNames does.
  const names = new Set<string>();
  const weights = new Set<number>();
  if (parsedDoc !== undefined) {
    for (const n of collectFontNamesFromDocx(parsedDoc)) names.add(n);
    for (const w of collectReferencedWeights(parsedDoc)) weights.add(w);
  }
  for (const theme of Object.values(customThemes ?? {})) {
    for (const n of collectFontNamesFromDocx(theme)) names.add(n);
    for (const w of collectReferencedWeights(theme)) weights.add(w);
  }

  const faces: PreviewFontFace[] = [];
  for (const entry of entries) faces.push(...facesFromRegistryEntry(entry));

  const googleHrefs: string[] = [];
  for (const g of googleFamiliesFor(names, entries, weights)) {
    try {
      faces.push(
        ...(await fetchGoogleFacesRewritten(
          g.family,
          g.weights,
          g.italics,
          opts?.fetchImpl ?? fetch
        ))
      );
    } catch {
      // Degrade to a plain link: 400/700 still render, intermediate weights
      // fall back to the host.
      googleHrefs.push(buildGoogleCss2Href(g.family, g.weights, g.italics));
    }
  }

  return { css: renderFontFaceCss(faces, opts?.maxBytes), googleHrefs };
}
