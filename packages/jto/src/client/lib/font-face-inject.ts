/**
 * Register an uploaded `kind:"data"` font with the parent document so the
 * font picker's preview card renders in the real typeface.
 *
 * The Google path does not need this — `ensureGoogleFontLoaded` appends a
 * stylesheet link, which is cheaper and resolves arbitrary families. Uploaded
 * bytes have no URL, so they go through the FontFace API instead.
 *
 * This is preview polish only: every failure is swallowed, because a card
 * rendering in a fallback face is acceptable and must never block the
 * registry write.
 */

const loaded = new Set<string>();

const keyFor = (family: string, weight: number, italic: boolean) =>
  `${family.toLowerCase()}|${weight}|${italic ? 'i' : 'r'}`;

/**
 * Inject a stylesheet link for a Google Font into document.head if missing.
 * Requests every weight the catalog advertises so a preview can render each
 * one in its own face — otherwise the browser would fall back to 400/700 and
 * the preview would lie about what's available.
 *
 * Shared by the font picker and the theme editor's specimen card. A family
 * that is not on Google Fonts costs one failed stylesheet request and
 * renders in the fallback face; nothing else depends on it.
 */
export function ensureGoogleFontLoaded(
  family: string,
  weights?: number[]
): void {
  if (typeof document === 'undefined' || !family.trim()) return;
  const id = `gf-${family.replace(/\s+/g, '-')}`;
  const existing = document.getElementById(id) as HTMLLinkElement | null;
  const requested = new Set(
    weights && weights.length > 0 ? weights : [400, 700]
  );
  // Union previously-requested weights with the new ones so a narrower
  // follow-up request never evicts weights already fetched — the browser
  // re-fetches the whole CSS whenever `.href` is reassigned, so only
  // rewrite when the union actually grows.
  const prior = new Set<number>(
    existing?.dataset.weights
      ?.split(',')
      .map(Number)
      .filter((n) => !Number.isNaN(n)) ?? []
  );
  const union = new Set<number>([...prior, ...requested]);
  if (existing && union.size === prior.size) return;

  const axis = [...union].sort((a, b) => a - b).join(';');
  const href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(
    family
  )}:wght@${axis}&display=swap`;
  const link = existing ?? document.createElement('link');
  if (!existing) {
    link.id = id;
    link.rel = 'stylesheet';
    document.head.appendChild(link);
  }
  link.href = href;
  link.dataset.weights = [...union].sort((a, b) => a - b).join(',');
}

function decodeBase64(b64: string): Uint8Array {
  const raw = b64.startsWith('data:') ? b64.slice(b64.indexOf(',') + 1) : b64;
  const binary = atob(raw);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** True once the face has been registered in this session. */
export function isDataFontLoaded(
  family: string,
  weight: number,
  italic: boolean
): boolean {
  return loaded.has(keyFor(family, weight, italic));
}

/** Add an uploaded font to `document.fonts` so previews can use it. */
export async function ensureDataFontLoaded(
  family: string,
  base64: string,
  weight: number,
  italic: boolean
): Promise<void> {
  const key = keyFor(family, weight, italic);
  if (loaded.has(key)) return;
  try {
    if (typeof FontFace === 'undefined' || !document?.fonts) return;
    const bytes = decodeBase64(base64);
    const face = new FontFace(family, bytes.buffer as ArrayBuffer, {
      weight: String(weight),
      style: italic ? 'italic' : 'normal',
    });
    await face.load();
    document.fonts.add(face);
    loaded.add(key);
  } catch {
    // Preview-only. The registry write is what matters.
  }
}
