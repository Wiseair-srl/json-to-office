/**
 * Lightweight JSON scanner that locates string-valued properties whose names
 * indicate a font reference. Used by the Monaco CodeLens provider to attach
 * a "Pick font…" action to those lines without standing up a full JSON
 * parser (Monaco bundles one internally but doesn't re-export it).
 *
 * Why not just regex? We need to distinguish `{"font": {"family": "Inter"}}`
 * from `{"family": "..."}` inside some unrelated structure, and we need
 * offsets of the string value (not just the key) to place the lens correctly.
 * A small token-and-stack scanner handles both.
 */
export interface FontLens {
  /** JSON path to the string value, e.g. ['props', 'font', 'family']. */
  path: (string | number)[];
  /** Current string value (unescaped). */
  value: string;
  /** Offset of the opening quote of the value. */
  valueStart: number;
  /** Offset just past the closing quote of the value. */
  valueEnd: number;
}

/**
 * Property names we attach a lens to. Matches any level of nesting — a
 * `family` property at any depth becomes a lens, as do all the PPTX chart-
 * specific *FontFace fields. `heading` and `body` are only lensed when
 * nested under a `fonts` object to avoid false positives.
 */
const ANYWHERE_KEYS = new Set([
  'family',
  'fontFace',
  'titleFontFace',
  'legendFontFace',
  'dataLabelFontFace',
  'catAxisLabelFontFace',
  'valAxisLabelFontFace',
]);

const UNDER_FONTS_KEYS = new Set(['heading', 'body']);

interface Frame {
  /** Current container type. */
  kind: 'object' | 'array';
  /** Object key the current value was assigned to (for objects). */
  key?: string;
  /** Array index of the next element (for arrays). */
  index?: number;
  /** Name under which this container was assigned in the parent. */
  parentKey?: string | number;
}

export function scanFontLenses(text: string): FontLens[] {
  const out: FontLens[] = [];
  // Start in a sentinel frame so we always have a container to walk from.
  const stack: Frame[] = [{ kind: 'object' }];
  let pos = 0;

  // Path tracking: we append parentKey when entering a container and pop
  // when leaving. Values themselves use stack[-1].key (object) or index
  // (array) to compute their own path.
  const pathStack: (string | number)[] = [];

  const isWS = (c: string) =>
    c === ' ' || c === '\t' || c === '\n' || c === '\r';

  const skipWS = () => {
    while (pos < text.length && isWS(text[pos])) pos++;
  };

  /**
   * Read a JSON string starting at the opening quote. Returns the unescaped
   * value and end-offset (position just past the closing quote). Throws are
   * swallowed by the caller — this scanner is best-effort.
   */
  const readString = (): { value: string; start: number; end: number } => {
    const start = pos;
    pos++; // consume opening "
    let value = '';
    while (pos < text.length) {
      const c = text[pos];
      if (c === '\\') {
        const next = text[pos + 1];
        // Minimal unescape — we only need enough to compare string values.
        if (next === '"') value += '"';
        else if (next === '\\') value += '\\';
        else if (next === '/') value += '/';
        else if (next === 'n') value += '\n';
        else if (next === 'r') value += '\r';
        else if (next === 't') value += '\t';
        else if (next === 'u') {
          const hex = text.slice(pos + 2, pos + 6);
          // Guard invalid hex: parseInt returns NaN, and String.fromCharCode(NaN)
          // produces the NUL char, silently corrupting the scanned string.
          if (/^[0-9a-fA-F]{4}$/.test(hex)) {
            value += String.fromCharCode(parseInt(hex, 16));
            pos += 6;
          } else {
            // Malformed escape (e.g. `\uZZ"` at end of string). Advance past
            // `\u` only — never consume more than is actually there, or we'd
            // skip past the closing quote and treat trailing JSON as string
            // content. Emit `\u` literally so values compare intelligibly.
            value += '\\u';
            pos += 2;
          }
          continue;
        } else {
          value += next ?? '';
        }
        pos += 2;
        continue;
      }
      if (c === '"') {
        pos++;
        return { value, start, end: pos };
      }
      value += c;
      pos++;
    }
    // Unterminated string — return what we have.
    return { value, start, end: pos };
  };

  /** Skip past a literal (true/false/null) or a number. */
  const skipPrimitive = () => {
    while (pos < text.length) {
      const c = text[pos];
      if (c === ',' || c === '}' || c === ']' || isWS(c)) return;
      pos++;
    }
  };

  /** Currently inside an object that lives at path `pathStack` + current key. */
  const currentPath = (): (string | number)[] => {
    const top = stack[stack.length - 1];
    if (!top) return pathStack.slice();
    if (top.kind === 'object') {
      if (top.key === undefined) return pathStack.slice();
      return [...pathStack, top.key];
    }
    if (top.kind === 'array') {
      return [...pathStack, top.index ?? 0];
    }
    return pathStack.slice();
  };

  const isLensTarget = (): boolean => {
    const top = stack[stack.length - 1];
    if (!top || top.kind !== 'object') return false;
    const key = top.key;
    if (!key) return false;
    if (ANYWHERE_KEYS.has(key)) return true;
    if (UNDER_FONTS_KEYS.has(key)) {
      // Require immediate parent object to be named 'fonts'.
      return pathStack[pathStack.length - 1] === 'fonts';
    }
    return false;
  };

  const parseValue = () => {
    skipWS();
    if (pos >= text.length) return;
    const c = text[pos];
    if (c === '"') {
      const { value, start, end } = readString();
      if (isLensTarget()) {
        out.push({
          path: currentPath(),
          value,
          valueStart: start,
          valueEnd: end,
        });
      }
      return;
    }
    if (c === '{') {
      const top = stack[stack.length - 1];
      const parentKey =
        top?.kind === 'object'
          ? top.key
          : top?.kind === 'array'
            ? top.index
            : undefined;
      if (parentKey !== undefined) pathStack.push(parentKey);
      pos++;
      stack.push({ kind: 'object', parentKey });
      parseObjectBody();
      stack.pop();
      if (parentKey !== undefined) pathStack.pop();
      return;
    }
    if (c === '[') {
      const top = stack[stack.length - 1];
      const parentKey =
        top?.kind === 'object'
          ? top.key
          : top?.kind === 'array'
            ? top.index
            : undefined;
      if (parentKey !== undefined) pathStack.push(parentKey);
      pos++;
      stack.push({ kind: 'array', index: 0, parentKey });
      parseArrayBody();
      stack.pop();
      if (parentKey !== undefined) pathStack.pop();
      return;
    }
    // number / true / false / null
    skipPrimitive();
  };

  const parseObjectBody = () => {
    skipWS();
    if (text[pos] === '}') {
      pos++;
      return;
    }
    while (pos < text.length) {
      skipWS();
      if (text[pos] !== '"') {
        // Malformed — bail on this object.
        while (pos < text.length && text[pos] !== '}') pos++;
        if (text[pos] === '}') pos++;
        return;
      }
      const { value: key } = readString();
      skipWS();
      if (text[pos] !== ':') return;
      pos++;
      const frame = stack[stack.length - 1];
      if (frame) frame.key = key;
      parseValue();
      if (frame) frame.key = undefined;
      skipWS();
      if (text[pos] === ',') {
        pos++;
        continue;
      }
      if (text[pos] === '}') {
        pos++;
        return;
      }
      return;
    }
  };

  const parseArrayBody = () => {
    skipWS();
    if (text[pos] === ']') {
      pos++;
      return;
    }
    while (pos < text.length) {
      parseValue();
      skipWS();
      if (text[pos] === ',') {
        pos++;
        const frame = stack[stack.length - 1];
        if (frame && frame.kind === 'array')
          frame.index = (frame.index ?? 0) + 1;
        continue;
      }
      if (text[pos] === ']') {
        pos++;
        return;
      }
      return;
    }
  };

  skipWS();
  parseValue();
  return out;
}
