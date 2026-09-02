import type { PluginFormat } from './types';

/**
 * The theme a browser plugin's `render` receives.
 *
 * Mirrors what the cores hand to disk plugins (`resolveThemeContext` in
 * core-docx and core-pptx): the document's `props.theme` looked up in the
 * playground's custom themes first (DOCX tolerates a case mismatch), then in
 * the built-in set the server reports, falling back to the format's default;
 * DOCX then merges `props.themeOverrides` and PPTX honours an inline theme
 * object. The export-mode font pre-pass is the one step not reproduced — it
 * only rewrites font family names, and the playground previews in the default
 * mode, where it is a no-op.
 */

type ThemeRecord = Record<string, unknown>;

function isRecord(value: unknown): value is ThemeRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Port of core-docx `applyThemeOverrides`: colors per token, fonts per role
 * (fields merged), styles per name (one level deep).
 */
export function applyDocxThemeOverrides(
  theme: ThemeRecord,
  overrides: unknown
): ThemeRecord {
  if (!isRecord(overrides)) return theme;
  const baseFonts: ThemeRecord = isRecord(theme.fonts) ? theme.fonts : {};
  const fonts: ThemeRecord = { ...baseFonts };
  if (isRecord(overrides.fonts)) {
    for (const [role, def] of Object.entries(overrides.fonts)) {
      const current = baseFonts[role];
      const existing: ThemeRecord = isRecord(current) ? current : {};
      fonts[role] = isRecord(def) ? { ...existing, ...def } : def;
    }
  }
  const baseStyles: ThemeRecord = isRecord(theme.styles) ? theme.styles : {};
  const styles: ThemeRecord = { ...baseStyles };
  if (isRecord(overrides.styles)) {
    for (const [name, def] of Object.entries(overrides.styles)) {
      const current = baseStyles[name];
      const existing: ThemeRecord = isRecord(current) ? current : {};
      styles[name] = isRecord(def) ? { ...existing, ...def } : def;
    }
  }
  return {
    ...theme,
    colors: {
      ...(isRecord(theme.colors) ? theme.colors : {}),
      ...(isRecord(overrides.colors) ? overrides.colors : {}),
    },
    fonts,
    ...(Object.keys(styles).length > 0 ? { styles } : {}),
  };
}

export interface ResolvePluginThemeOptions {
  format: PluginFormat;
  /** Valid custom themes, keyed by theme name (not file name). */
  customThemes: Record<string, unknown>;
  /** Built-in themes as `GET /api/discovery/themes/builtin` reports them. */
  builtinThemes: Record<string, unknown>;
}

const DEFAULT_THEME_NAME: Record<PluginFormat, string> = {
  docx: 'minimal',
  pptx: 'default',
};

export interface ResolvedPluginTheme {
  theme: unknown;
  /**
   * Set when the document named a theme nobody has, mirroring the
   * `theme_not_found` warning core-docx raises before it falls back.
   */
  warning?: { message: string; context: Record<string, unknown> };
}

export function resolvePluginThemeDetailed(
  document: unknown,
  options: ResolvePluginThemeOptions
): ResolvedPluginTheme {
  const { format, customThemes, builtinThemes } = options;
  const props =
    isRecord(document) && isRecord(document.props) ? document.props : {};
  const authored = props.theme;

  if (format === 'pptx' && isRecord(authored)) {
    return { theme: authored };
  }

  const name =
    typeof authored === 'string' && authored.length > 0
      ? authored
      : DEFAULT_THEME_NAME[format];

  let theme: unknown = customThemes[name];
  if (theme === undefined && format === 'docx') {
    const lower = name.toLowerCase();
    const key = Object.keys(customThemes).find(
      (k) => k.toLowerCase() === lower
    );
    if (key) theme = customThemes[key];
  }
  if (theme === undefined) theme = builtinThemes[name];
  let warning: ResolvedPluginTheme['warning'];
  if (theme === undefined) {
    const fallback = DEFAULT_THEME_NAME[format];
    const available = [
      ...Object.keys(builtinThemes),
      ...Object.keys(customThemes),
    ].sort();
    warning = {
      message: `Theme "${name}" not found; falling back to "${fallback}". Available themes: ${available.join(', ')}.`,
      context: { code: 'theme_not_found', requested: name, available },
    };
    theme = builtinThemes[fallback];
  }
  if (theme === undefined) {
    const first = Object.values(builtinThemes)[0];
    theme = first ?? {};
  }

  const resolved =
    format === 'docx' && isRecord(theme) && props.themeOverrides
      ? applyDocxThemeOverrides(theme, props.themeOverrides)
      : theme;
  return warning ? { theme: resolved, warning } : { theme: resolved };
}

export function resolvePluginTheme(
  document: unknown,
  options: ResolvePluginThemeOptions
): unknown {
  return resolvePluginThemeDetailed(document, options).theme;
}
