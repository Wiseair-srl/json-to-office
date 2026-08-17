/**
 * Shared generation prologue.
 *
 * Both entry points — `generateBufferWithWarnings` (core) and
 * `createPresentationGenerator` (plugin) — must resolve the same theme, run
 * the same export-mode pre-pass, and derive the same cache key before slide
 * processing runs. Keeping two copies of that is how DOCX silently dropped a
 * root-level prop from one path (#133); this module is the single definition
 * so the next root-level prop cannot diverge (#134). Mirrors
 * core-docx/src/core/generationContext.ts.
 *
 * The prologue deliberately stops before font resolution: the core path
 * resolves fonts straight after this, while the plugin path must first expand
 * custom components (which can introduce new families). The export-mode
 * pre-pass runs here, BEFORE expansion, so custom components reading
 * `theme.fonts.*` during render see substituted names, not the original
 * non-safe ones.
 */

import type {
  PresentationComponentDefinition,
  PptxThemeConfig,
  PipelineWarning,
} from '../types';
import type { FontRuntimeOpts } from '@json-to-office/shared';
import { applyExportMode, scopedThemeName } from '@json-to-office/shared';
import { getPptxTheme } from '../themes/defaults';

export interface ThemeContextOptions {
  customThemes?: Record<string, PptxThemeConfig>;
  fonts?: FontRuntimeOpts;
  warnings?: PipelineWarning[];
  /**
   * Base theme name when the document doesn't name one. The plugin builder
   * passes its constructor-supplied string theme; defaults to 'default'.
   */
  defaultThemeName?: string;
  /**
   * Theme lookup for the base `props.theme` name. The plugin builder passes
   * its own (customThemes → constructor theme object → built-in); omit it to
   * use customThemes → built-in.
   */
  resolveNamedTheme?: (name: string) => PptxThemeConfig;
}

export interface GenerationThemeContext {
  /**
   * The document after the export-mode pre-pass rewrote font references.
   * `props.theme` stays as authored (name or inline object) — callers hand
   * `theme` to `processPresentation` by value instead of round-tripping it
   * through a name lookup (#135).
   */
  document: PresentationComponentDefinition;
  theme: PptxThemeConfig;
  /**
   * Cache key: base theme name + export-mode scope. Nothing in PPTX consumes
   * a theme by name after the prologue today; this is the key a future
   * theme-keyed cache must use (a substitute-mode run rewrites the theme in
   * place, so it must never share a slot with a custom-mode run of the same
   * base name — the DOCX layout cache is keyed exactly this way).
   */
  themeName: string;
}

export function resolveThemeContext(
  documentIn: PresentationComponentDefinition,
  options: ThemeContextOptions = {}
): GenerationThemeContext {
  const { customThemes, fonts, warnings, defaultThemeName, resolveNamedTheme } =
    options;

  // A root written without a `props` key is defaulted here — otherwise the
  // first downstream `document.props.*` read throws a raw TypeError. Only
  // `undefined` is defaulted: `props: null` is malformed and must be rejected
  // rather than quietly rewritten into a valid shape. Both entry points
  // validate before reaching here when validation is enabled (the PPTX
  // validator rejects a missing `props`); this covers the
  // `validation: { enabled: false }` route. Matches DOCX.
  if (documentIn.props === null) {
    throw new Error(
      'Document `props` is null. Omit it, or provide an object — ' +
        'a null props cannot carry a theme.'
    );
  }
  let document =
    documentIn.props === undefined ? { ...documentIn, props: {} } : documentIn;

  // An inline theme object (self-contained document) resolves directly and
  // wins over any customThemes entry sharing its name, on both paths. The
  // document keeps the authored object — nothing downstream resolves the
  // theme by name anymore.
  let inlineTheme: PptxThemeConfig | undefined;
  if (
    typeof document.props.theme === 'object' &&
    document.props.theme !== null
  ) {
    inlineTheme = document.props.theme as PptxThemeConfig;
  }

  const baseThemeName = inlineTheme
    ? inlineTheme.name || 'inline-theme'
    : (document.props.theme as string | undefined) ??
      defaultThemeName ??
      'default';
  let theme =
    inlineTheme ??
    (resolveNamedTheme
      ? resolveNamedTheme(baseThemeName)
      : customThemes?.[baseThemeName] ?? getPptxTheme(baseThemeName));

  // Export-mode pre-pass: substitute rewrites non-safe families in place;
  // custom leaves refs untouched and resolution short-circuits to empty.
  const mode = applyExportMode({ doc: document, theme, fonts });
  document = mode.doc;
  theme = mode.theme;
  for (const w of mode.warnings) {
    warnings?.push({
      code: w.code,
      message: w.message,
      component: 'fontRegistry',
    });
  }

  return {
    document,
    theme,
    themeName: scopedThemeName(baseThemeName, fonts?.mode),
  };
}
