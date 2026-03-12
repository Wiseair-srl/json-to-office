/**
 * Theme JSON Schema — fetched from the server (format-aware)
 */

let _cachedSchema: any | null = null;

/**
 * Fetch the theme JSON schema from the server.
 * Result is cached for the lifetime of the session.
 */
export async function fetchThemeJsonSchema(): Promise<any> {
  if (_cachedSchema) return _cachedSchema;

  const res = await fetch('/api/discovery/schemas/theme');
  const json = await res.json();
  if (!json.success) throw new Error(json.error ?? 'Failed to fetch theme schema');

  _cachedSchema = json.data;
  return _cachedSchema;
}
