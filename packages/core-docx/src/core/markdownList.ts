/**
 * Markdown list syntax inside a paragraph's text.
 *
 * A paragraph whose whole text is `- one\n- two` is a list, not prose, and has
 * always rendered as one. Detecting that is a pure reading of the text with no
 * renderer in it, so both the pre-IR writer and the DocxIR compiler read it
 * here rather than each deciding for itself what counts as a list.
 */

export interface MarkdownList {
  type: 'unordered' | 'ordered';
  items: { text: string; level: number }[];
}

/**
 * Parse markdown list syntax from paragraph text
 * Returns null if no list detected, or { type, items } if list found
 */
export function parseMarkdownList(text: string): MarkdownList | null {
  const lines = text.split('\n');
  const items: { text: string; level: number }[] = [];
  let isUnordered: boolean | null = null;
  let isOrdered: boolean | null = null;

  for (const line of lines) {
    // Skip empty lines
    if (!line.trim()) continue;

    // Match unordered list: optional spaces + (- or *) + space + text
    const unorderedMatch = line.match(/^(\s*)([-*])\s+(.+)$/);
    if (unorderedMatch) {
      const indentLevel = Math.floor(unorderedMatch[1].length / 2); // 2 spaces = 1 level
      const text = unorderedMatch[3];
      items.push({ text, level: indentLevel });
      if (isUnordered === null) isUnordered = true;
      continue;
    }

    // Match ordered list: optional spaces + number + . + space + text
    const orderedMatch = line.match(/^(\s*)(\d+)\.\s+(.+)$/);
    if (orderedMatch) {
      const indentLevel = Math.floor(orderedMatch[1].length / 2); // 2 spaces = 1 level
      const text = orderedMatch[3];
      items.push({ text, level: indentLevel });
      if (isOrdered === null) isOrdered = true;
      continue;
    }

    // If we find a line that doesn't match list syntax, this isn't a list
    return null;
  }

  // If no items found, or mixed list types, not a valid list
  if (items.length === 0 || (isUnordered && isOrdered)) {
    return null;
  }

  return {
    type: isUnordered ? 'unordered' : 'ordered',
    items,
  };
}
