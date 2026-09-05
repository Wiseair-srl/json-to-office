/**
 * Shared generation prologue.
 *
 * Both entry points — `generateBufferFromJson` (core) and
 * `createDocumentGenerator` (plugin) — must resolve the same theme, apply the
 * same in-document overrides, and apply the same export mode before the
 * structure → layout → render engine runs. Keeping two copies of that meant
 * `props.themeOverrides` reached only one of them (#133); this module is the
 * single definition so the next root-level prop cannot diverge (#132).
 *
 * The prologue deliberately stops before font resolution: the core path
 * resolves fonts straight after this, while the plugin path must first expand
 * custom components (which can introduce new families).
 */

import type { ReportComponentDefinition } from '../types';
import type { ThemeConfig } from '../styles';
import type {
  FontRuntimeOpts,
  GenerationWarning,
} from '@json-to-office/shared';
import { applyExportMode } from '@json-to-office/shared';
import { resolveBuiltInTheme } from '../styles/theme-resolver';
import { applyThemeOverrides } from '../themes/overrides';
import { resolveDocxDesignSystem } from '../themes/design-system';

export interface ThemeContextOptions {
  customThemes?: { [key: string]: ThemeConfig };
  fonts?: FontRuntimeOpts;
  warnings?: GenerationWarning[];
  /**
   * Theme lookup for the base `props.theme` name. The plugin builder passes
   * its own (customThemes → doc-named built-in → constructor-supplied theme →
   * built-in); omit it to use customThemes → built-in. `authored` is true when
   * the name came from the document's own `props.theme` (not the 'minimal'
   * fallback), so the lookup can honor an explicitly doc-named built-in
   * without the constructor theme being shadowed for unnamed docs (#141).
   */
  resolveNamedTheme?: (
    name: string,
    warnings: GenerationWarning[] | undefined,
    authored: boolean
  ) => ThemeConfig;
}

export interface GenerationThemeContext {
  /** The document after the export-mode pre-pass rewrote font references. */
  document: ReportComponentDefinition;
  theme: ThemeConfig;
  /** Base theme name, retained for built-in fallback lookups. */
  themeName: string;
}

/** customThemes lookup with the case-insensitive fallback, then built-ins. */
function defaultNamedThemeLookup(
  themeName: string,
  customThemes: { [key: string]: ThemeConfig } | undefined,
  warnings?: GenerationWarning[]
): ThemeConfig {
  if (customThemes) {
    if (customThemes[themeName]) return customThemes[themeName];
    const themeNameLower = themeName.toLowerCase();
    const matchingThemeKey = Object.keys(customThemes).find(
      (key) => key.toLowerCase() === themeNameLower
    );
    if (matchingThemeKey) return customThemes[matchingThemeKey];
    return resolveBuiltInTheme(themeName, { customThemes, warnings });
  }
  return resolveBuiltInTheme(themeName, { warnings });
}

export function resolveThemeContext(
  documentIn: ReportComponentDefinition,
  options: ThemeContextOptions = {}
): GenerationThemeContext {
  const { customThemes, fonts, warnings, resolveNamedTheme } = options;

  // A root written without a `props` key validates clean, so default it here —
  // otherwise every downstream `document.props.*` read (theme, componentDefaults,
  // noProofWords, trackRevisions, language, metadata) throws. Only `undefined`
  // is defaulted: `props: null` is malformed and must be rejected rather than
  // quietly rewritten into a valid shape.
  //
  // Both JSON entry points validate before reaching here, so null is already
  // a validation error there. `generateDocument` on a document without
  // `$schema` runs no validator at all, and used to surface this as
  // `Cannot read properties of null` from the theme read below.
  if (documentIn.props === null) {
    throw new Error(
      'Document `props` is null. Omit it, or provide an object — ' +
        'a null props cannot carry a theme.'
    );
  }
  const document =
    documentIn.props === undefined ? { ...documentIn, props: {} } : documentIn;

  const authoredThemeName = document.props.theme || undefined;
  const baseThemeName = authoredThemeName ?? 'minimal';
  let theme = resolveNamedTheme
    ? resolveNamedTheme(
        baseThemeName,
        warnings,
        authoredThemeName !== undefined
      )
    : defaultNamedThemeLookup(baseThemeName, customThemes, warnings);

  // In-document partial theme, merged before the export-mode pre-pass so a
  // font-family override is visible to it.
  const themeOverrides = document.props.themeOverrides;
  if (themeOverrides) {
    theme = applyThemeOverrides(theme, themeOverrides);
  }

  // Export-mode pre-pass: substitute (default) rewrites non-safe families to
  // safe equivalents; custom keeps refs as-is.
  theme = resolveDocxDesignSystem(theme);
  const mode = applyExportMode({ doc: document, theme, fonts });
  for (const w of mode.warnings) {
    if (warnings) {
      warnings.push({
        component: 'fontRegistry',
        message: w.message,
        severity: 'warning',
        context: { code: w.code },
      });
    } else {
      // eslint-disable-next-line no-console
      console.warn(`[json-to-docx] [${w.code}] ${w.message}`);
    }
  }

  return {
    document: mode.doc,
    theme: mode.theme,
    themeName: baseThemeName,
  };
}
