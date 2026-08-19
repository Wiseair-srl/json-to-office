/**
 * Long-string collapser for the JSON Monaco editor.
 *
 * Very long string *values* (base64 images, embedded SVGs, big data blobs, …)
 * make the editor unusable: with wordWrap on they wrap into hundreds of rows.
 *
 * Monaco cannot hide a substring of a line (decorations only style/inject
 * text; folding/setHiddenAreas work on whole lines). So the only way to
 * actually reclaim vertical space is to remove the characters from the model.
 *
 * Strategy: keep a short head and tail of the real value visible and replace
 * only the MIDDLE (in place, on the same logical line — so every OTHER line
 * number stays valid) with a short sentinel `§jtoc:<id>§`. The sentinel is
 * hidden via CSS and a clickable chip is rendered in its place, so a value
 * reads like:  "data:image/png;base64,iVBOR …⟨12.4 KB⟩… AAAA". Clicking the
 * chip toggles expand/collapse. The hidden middle is kept in a map and
 * re-inserted before the value is saved, so persistence is lossless.
 *
 * Save safety: collapse/expand edits run with an `applying` flag set; the
 * editor component skips its save side-effect for those programmatic changes,
 * and `toStorageValue()` reconstructs the full document before any real save.
 */
import type { Monaco } from '@monaco-editor/react';
import type { editor, IDisposable, IRange, IPosition } from 'monaco-editor';

/** Collapse string values longer than this many (escaped) characters. */
const THRESHOLD = 200;
/** How much of the start / end of the value to keep visible. */
const HEAD_CHARS = 32;
const TAIL_CHARS = 12;
/** Don't bother collapsing if less than this would be hidden. */
const MIN_MIDDLE_CHARS = 40;

const SENTINEL_PREFIX = '§jtoc:';
const SENTINEL_SUFFIX = '§';

const STYLE_ID = 'jto-collapse-strings-styles';

interface TrackedString {
  id: number;
  middle: string; // the hidden middle slice, exactly as it appears in the model
  expanded: boolean;
  decorationId: string;
}

interface ScanHit {
  innerStart: number; // offset of first char after the opening quote
  innerEnd: number; // offset of the closing quote
  inner: string;
}

export interface CollapseController {
  /** Reset state and collapse all long strings in the current model. */
  recollapse(): void;
  /** Collapse newly-introduced long strings, skipping the one under the cursor. */
  collapseNew(cursorOffset?: number): void;
  /** Reconstruct the full document text (sentinels → original values) for saving. */
  toStorageValue(modelText: string): string;
  /** True while collapse/expand edits are being applied programmatically. */
  isApplyingEdits(): boolean;
  /** True if a marker range falls inside a currently-collapsed value. */
  isRangeCollapsed(range: IRange): boolean;
  /**
   * Re-anchor chip decorations to their sentinels' current positions. Call
   * after an edit that MOVES text wholesale (outline drag-reorder, undo of
   * one): Monaco collapses decorations that sat inside a replaced range, but
   * the sentinel text itself travels with the edit and carries its id, so the
   * decoration can always be rebuilt at the sentinel's new location.
   */
  resyncDecorations(): void;
  dispose(): void;
}

function ensureStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.jto-collapsed-token { display: none !important; }
.jto-collapsed-chip, .jto-expand-collapse-chip {
  color: #7c8595;
  background: rgba(127,127,127,0.14);
  border: 1px solid rgba(127,127,127,0.30);
  border-radius: 4px;
  padding: 0 6px;
  cursor: pointer;
  font-style: italic;
  font-size: 0.85em;
}
.jto-collapsed-chip { margin: 0 2px; }
.jto-expand-collapse-chip { margin-right: 4px; }
.jto-collapsed-chip:hover, .jto-expand-collapse-chip:hover {
  background: rgba(127,127,127,0.28);
  color: #aab3c2;
}
`;
  document.head.appendChild(style);
}

/** Scan JSON text for string values longer than the threshold (skips ones that already hold a sentinel). */
function scanLongStrings(text: string): ScanHit[] {
  const hits: ScanHit[] = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    if (text[i] !== '"') {
      i++;
      continue;
    }
    const innerStart = i + 1;
    let j = innerStart;
    while (j < n) {
      const c = text[j];
      if (c === '\\') {
        j += 2;
        continue;
      }
      if (c === '"') break;
      j++;
    }
    if (j < n) {
      const inner = text.slice(innerStart, j);
      if (inner.length > THRESHOLD && !inner.includes(SENTINEL_PREFIX)) {
        hits.push({ innerStart, innerEnd: j, inner });
      }
    }
    i = j + 1;
  }
  return hits;
}

/**
 * Split an escaped JSON string into {prefix, middle, suffix}, cutting only at
 * escape-safe boundaries so neither piece ends mid-escape (`\"`, `\uXXXX`, …).
 * Returns null when there isn't enough middle to be worth collapsing.
 */
function splitPreserveEscapes(
  raw: string
): { prefix: string; middle: string; suffix: string } | null {
  const n = raw.length;
  // Offsets that sit between complete characters/escape sequences.
  const safe = new Set<number>([0]);
  let i = 0;
  while (i < n) {
    if (raw[i] === '\\') {
      i = Math.min(i + (raw[i + 1] === 'u' ? 6 : 2), n);
    } else {
      i += 1;
    }
    safe.add(i);
  }
  let headCut = Math.min(HEAD_CHARS, n);
  while (headCut > 0 && !safe.has(headCut)) headCut--;
  let tailStart = Math.max(n - TAIL_CHARS, headCut);
  while (tailStart < n && !safe.has(tailStart)) tailStart++;
  const middle = raw.slice(headCut, tailStart);
  if (middle.length < MIN_MIDDLE_CHARS) return null;
  return {
    prefix: raw.slice(0, headCut),
    middle,
    suffix: raw.slice(tailStart),
  };
}

function formatSize(chars: number): string {
  // String length ≈ byte count for the typical ASCII payloads we collapse.
  if (chars < 1024) return `${chars} chars`;
  if (chars < 1024 * 1024) return `${(chars / 1024).toFixed(1)} KB`;
  return `${(chars / (1024 * 1024)).toFixed(1)} MB`;
}

function positionTouchesRange(pos: IPosition, range: IRange): boolean {
  // Pad by one column: injected chip text (before/after) anchors at the range
  // edge, so a click on the chip can map to the column just outside it.
  if (
    pos.lineNumber < range.startLineNumber ||
    pos.lineNumber > range.endLineNumber
  ) {
    return false;
  }
  if (
    pos.lineNumber === range.startLineNumber &&
    pos.column < range.startColumn - 1
  ) {
    return false;
  }
  if (
    pos.lineNumber === range.endLineNumber &&
    pos.column > range.endColumn + 1
  ) {
    return false;
  }
  return true;
}

function rangesOverlap(a: IRange, b: IRange): boolean {
  if (
    a.endLineNumber < b.startLineNumber ||
    b.endLineNumber < a.startLineNumber
  ) {
    return false;
  }
  if (a.endLineNumber === b.startLineNumber && a.endColumn < b.startColumn) {
    return false;
  }
  if (b.endLineNumber === a.startLineNumber && b.endColumn < a.startColumn) {
    return false;
  }
  return true;
}

export function installLongStringCollapser(
  editorInstance: editor.IStandaloneCodeEditor,
  monaco: Monaco
): CollapseController {
  ensureStyles();

  const tracked = new Map<number, TrackedString>();
  const disposables: IDisposable[] = [];
  let nextId = 1;
  let applying = false;

  const makeSentinel = (id: number) =>
    `${SENTINEL_PREFIX}${id}${SENTINEL_SUFFIX}`;

  /** Expand any collapsed sentinels in `text` back to their original middles. */
  function reconstruct(text: string): string {
    if (tracked.size === 0) return text;
    let out = text;
    for (const t of tracked.values()) {
      if (t.expanded) continue; // already full text in the model
      out = out.split(makeSentinel(t.id)).join(t.middle);
    }
    return out;
  }

  function collapsedDecoration(
    middleLen: number
  ): editor.IModelDecorationOptions {
    return {
      inlineClassName: 'jto-collapsed-token',
      after: {
        content: ` … ⟨ ${formatSize(middleLen)} ⟩ … `,
        inlineClassName: 'jto-collapsed-chip',
      },
      stickiness:
        monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
      hoverMessage: { value: 'Click to expand the collapsed value' },
    };
  }

  function expandedDecoration(): editor.IModelDecorationOptions {
    return {
      before: {
        content: ' ⟨ collapse ⟩ ',
        inlineClassName: 'jto-expand-collapse-chip',
      },
      stickiness:
        monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
      hoverMessage: { value: 'Click to collapse this value again' },
    };
  }

  /** Live ranges of currently-expanded tracked values (to avoid re-collapsing them). */
  function expandedRanges(model: editor.ITextModel): IRange[] {
    const ranges: IRange[] = [];
    for (const t of tracked.values()) {
      if (!t.expanded) continue;
      const r = model.getDecorationRange(t.decorationId);
      if (r) ranges.push(r);
    }
    return ranges;
  }

  function collapseHits(hits: ScanHit[]): void {
    const model = editorInstance.getModel();
    if (!model || hits.length === 0) return;
    applying = true;
    try {
      // Bottom-up: editing a lower region never invalidates the offsets above it.
      for (let k = hits.length - 1; k >= 0; k--) {
        const hit = hits[k];
        const split = splitPreserveEscapes(hit.inner);
        if (!split) continue;
        const id = nextId++;
        const sentinel = makeSentinel(id);
        const startPos = model.getPositionAt(hit.innerStart);
        const endPos = model.getPositionAt(hit.innerEnd);
        const innerRange = new monaco.Range(
          startPos.lineNumber,
          startPos.column,
          endPos.lineNumber,
          endPos.column
        );
        model.applyEdits([
          {
            range: innerRange,
            text: split.prefix + sentinel + split.suffix,
            forceMoveMarkers: true,
          },
        ]);
        // The sentinel sits between the (still-visible) head and tail.
        const sentinelStart = hit.innerStart + split.prefix.length;
        const tokenStart = model.getPositionAt(sentinelStart);
        const tokenEnd = model.getPositionAt(sentinelStart + sentinel.length);
        const tokenRange = new monaco.Range(
          tokenStart.lineNumber,
          tokenStart.column,
          tokenEnd.lineNumber,
          tokenEnd.column
        );
        const [decorationId] = editorInstance.deltaDecorations(
          [],
          [
            {
              range: tokenRange,
              options: collapsedDecoration(split.middle.length),
            },
          ]
        );
        tracked.set(id, {
          id,
          middle: split.middle,
          expanded: false,
          decorationId,
        });
      }
    } finally {
      applying = false;
    }
  }

  function expand(id: number): void {
    const model = editorInstance.getModel();
    const t = tracked.get(id);
    if (!model || !t || t.expanded) return;
    const range = model.getDecorationRange(t.decorationId);
    if (!range) return;
    applying = true;
    try {
      model.applyEdits([{ range, text: t.middle, forceMoveMarkers: true }]);
      const startOff = model.getOffsetAt({
        lineNumber: range.startLineNumber,
        column: range.startColumn,
      });
      const endPos = model.getPositionAt(startOff + t.middle.length);
      const middleRange = new monaco.Range(
        range.startLineNumber,
        range.startColumn,
        endPos.lineNumber,
        endPos.column
      );
      const [decorationId] = editorInstance.deltaDecorations(
        [t.decorationId],
        [{ range: middleRange, options: expandedDecoration() }]
      );
      t.decorationId = decorationId;
      t.expanded = true;
    } finally {
      applying = false;
    }
  }

  function recollapseOne(id: number): void {
    const model = editorInstance.getModel();
    const t = tracked.get(id);
    if (!model || !t || !t.expanded) return;
    const range = model.getDecorationRange(t.decorationId);
    if (!range) return;
    // Re-read in case the user edited the middle while it was expanded.
    const currentMiddle = model.getValueInRange(range);
    t.middle = currentMiddle;
    const sentinel = makeSentinel(id);
    applying = true;
    try {
      model.applyEdits([{ range, text: sentinel, forceMoveMarkers: true }]);
      const startOff = model.getOffsetAt({
        lineNumber: range.startLineNumber,
        column: range.startColumn,
      });
      const tokenEnd = model.getPositionAt(startOff + sentinel.length);
      const tokenRange = new monaco.Range(
        range.startLineNumber,
        range.startColumn,
        tokenEnd.lineNumber,
        tokenEnd.column
      );
      const [decorationId] = editorInstance.deltaDecorations(
        [t.decorationId],
        [
          {
            range: tokenRange,
            options: collapsedDecoration(currentMiddle.length),
          },
        ]
      );
      t.decorationId = decorationId;
      t.expanded = false;
    } finally {
      applying = false;
    }
  }

  disposables.push(
    editorInstance.onMouseDown((e) => {
      const pos = e.target.position;
      if (!pos) return;
      const model = editorInstance.getModel();
      if (!model) return;
      for (const t of tracked.values()) {
        const range = model.getDecorationRange(t.decorationId);
        if (!range) continue;
        if (positionTouchesRange(pos, range)) {
          if (t.expanded) recollapseOne(t.id);
          else expand(t.id);
          e.event.preventDefault();
          e.event.stopPropagation();
          return;
        }
      }
    })
  );

  // Copy/cut must yield the REAL value, not the hidden `§jtoc:<id>§` sentinel
  // (it lives in the model text — CSS only hides it). Intercept in the capture
  // phase so we run before Monaco's own clipboard handler, then fully take over
  // (set the reconstructed text, and for cut delete the selection ourselves).
  const handleClipboard = (e: ClipboardEvent) => {
    if (tracked.size === 0) return;
    const model = editorInstance.getModel();
    const selection = editorInstance.getSelection();
    if (!model || !selection || selection.isEmpty()) return;
    const selected = model.getValueInRange(selection);
    if (!selected.includes(SENTINEL_PREFIX)) return;
    const reconstructed = reconstruct(selected);
    if (reconstructed === selected) return;
    e.clipboardData?.setData('text/plain', reconstructed);
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.type === 'cut') {
      // Real content change — leave `applying` unset so the edit is persisted.
      editorInstance.executeEdits('jto-collapse-cut', [
        { range: selection, text: '' },
      ]);
    }
  };

  const domNode = editorInstance.getDomNode();
  if (domNode) {
    domNode.addEventListener('copy', handleClipboard, true);
    domNode.addEventListener('cut', handleClipboard, true);
    disposables.push({
      dispose() {
        domNode.removeEventListener('copy', handleClipboard, true);
        domNode.removeEventListener('cut', handleClipboard, true);
      },
    });
  }

  return {
    recollapse() {
      const model = editorInstance.getModel();
      if (!model) return;
      // Restore any live sentinels to their full text first, so a redundant
      // call (or one after the model was edited) never strands a sentinel in
      // the model with no mapping — which would otherwise be saved verbatim.
      applying = true;
      try {
        for (const t of tracked.values()) {
          if (t.expanded) continue;
          const r = model.getDecorationRange(t.decorationId);
          if (r) {
            model.applyEdits([
              { range: r, text: t.middle, forceMoveMarkers: true },
            ]);
          }
        }
      } finally {
        applying = false;
      }
      const stale = [...tracked.values()].map((t) => t.decorationId);
      if (stale.length) editorInstance.deltaDecorations(stale, []);
      tracked.clear();
      collapseHits(scanLongStrings(model.getValue()));
    },

    collapseNew(cursorOffset?: number) {
      const model = editorInstance.getModel();
      if (!model) return;
      const skip = expandedRanges(model);
      const hits = scanLongStrings(model.getValue()).filter((hit) => {
        // Don't yank the string the user is currently typing into.
        if (
          cursorOffset !== undefined &&
          cursorOffset >= hit.innerStart - 1 &&
          cursorOffset <= hit.innerEnd + 1
        ) {
          return false;
        }
        // Don't re-collapse a value the user has deliberately expanded.
        const start = model.getPositionAt(hit.innerStart);
        const end = model.getPositionAt(hit.innerEnd);
        const hitRange: IRange = {
          startLineNumber: start.lineNumber,
          startColumn: start.column,
          endLineNumber: end.lineNumber,
          endColumn: end.column,
        };
        return !skip.some((r) => rangesOverlap(r, hitRange));
      });
      collapseHits(hits);
    },

    toStorageValue(modelText: string): string {
      return reconstruct(modelText);
    },

    isApplyingEdits() {
      return applying;
    },

    isRangeCollapsed(range: IRange): boolean {
      const model = editorInstance.getModel();
      if (!model) return false;
      for (const t of tracked.values()) {
        if (t.expanded) continue;
        const r = model.getDecorationRange(t.decorationId);
        if (r && rangesOverlap(r, range)) return true;
      }
      return false;
    },

    resyncDecorations() {
      const model = editorInstance.getModel();
      if (!model || tracked.size === 0) return;
      const text = model.getValue();
      for (const t of [...tracked.values()]) {
        if (t.expanded) {
          // The full value is plain text in the model; if the collapse chip
          // still marks exactly that text, keep it — otherwise drop the entry
          // (the value simply stays expanded).
          const r = model.getDecorationRange(t.decorationId);
          if (!r || model.getValueInRange(r) !== t.middle) {
            editorInstance.deltaDecorations([t.decorationId], []);
            tracked.delete(t.id);
          }
          continue;
        }
        const sentinel = makeSentinel(t.id);
        const offset = text.indexOf(sentinel);
        if (offset === -1) {
          // Sentinel text was destroyed by an edit; the hidden middle is gone
          // the same way it would be if the user deleted the chip directly.
          editorInstance.deltaDecorations([t.decorationId], []);
          tracked.delete(t.id);
          continue;
        }
        const start = model.getPositionAt(offset);
        const end = model.getPositionAt(offset + sentinel.length);
        const current = model.getDecorationRange(t.decorationId);
        if (
          current &&
          current.startLineNumber === start.lineNumber &&
          current.startColumn === start.column &&
          current.endLineNumber === end.lineNumber &&
          current.endColumn === end.column
        ) {
          continue; // already anchored correctly
        }
        const [decorationId] = editorInstance.deltaDecorations(
          [t.decorationId],
          [
            {
              range: new monaco.Range(
                start.lineNumber,
                start.column,
                end.lineNumber,
                end.column
              ),
              options: collapsedDecoration(t.middle.length),
            },
          ]
        );
        t.decorationId = decorationId;
      }
    },

    dispose() {
      for (const d of disposables) d.dispose();
      const model = editorInstance.getModel();
      if (model) {
        const ids = [...tracked.values()].map((t) => t.decorationId);
        if (ids.length) editorInstance.deltaDecorations(ids, []);
      }
      tracked.clear();
    },
  };
}
