/**
 * Strip leading '#' from a hex colour string.
 * pptxgenjs expects bare 6-char hex (e.g. 'FF0000'), but our theme
 * convention uses '#'-prefixed values (e.g. '#FF0000').
 */
export function toHex(color: string): string {
  return color.startsWith('#') ? color.slice(1) : color;
}
