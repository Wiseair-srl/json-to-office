/**
 * A theme, described rather than dumped.
 *
 * `jto://themes/values` is the raw style table — hundreds of lines nobody
 * chooses a look from. This is the sentence and the handful of values an
 * agent chooses from: the voice, when to use it, the two typefaces, the
 * palette by token, and for an extended theme the resolved type roles, the
 * scale, the spacing, the chrome recipes it carries and its motif. Every
 * value is read off the theme the core ships, so the summary cannot say
 * something the theme does not do.
 */

import {
  designCanvas,
  designColors,
  resolveTypeRoles,
  type DesignSystem,
} from '@json-to-office/shared';

import type { FormatName } from './adapters.js';
import { loadCore } from './core.js';

/** What discovery says about a theme: enough to choose, never the values. */
export interface ThemeSummary {
  name: string;
  displayName: string;
  /** The visual voice, in one sentence. */
  description: string;
  /** The documents it suits. */
  whenToUse: string;
  /** True when the theme is a complete visual system: type roles, scale, spacing, chrome. */
  extended: boolean;
}

/** `jto://themes`: the summary plus the values a choice is made on. */
export interface ThemeDescription extends ThemeSummary {
  fonts: { heading: string; body: string };
  /** Token to `#RRGGBB`, palette roles over the legacy colours. */
  palette: Record<string, string>;
  typography?: {
    /** Role to the size it resolves to on the format's default canvas, in points. */
    roles: Record<string, number>;
    scale?: Record<string, { base: number; ratio?: number }>;
  };
  spacing?: DesignSystem['spacing'];
  /** The chrome recipes the theme carries, by name. */
  chrome?: string[];
  motif?: string;
}

type Rec = Record<string, unknown>;

const asRecord = (value: unknown): Rec | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Rec)
    : undefined;

function family(font: unknown): string {
  if (typeof font === 'string') return font;
  const named = asRecord(font)?.family;
  return typeof named === 'string' ? named : '';
}

function bodySize(theme: Rec, format: FormatName): number {
  const fonts = asRecord(theme.fonts);
  const body = asRecord(fonts?.body)?.size;
  if (typeof body === 'number') return body;
  const defaults = asRecord(theme.defaults)?.fontSize;
  return typeof defaults === 'number' ? defaults : format === 'docx' ? 11 : 18;
}

function stringMap(value: unknown): Record<string, string> {
  return Object.fromEntries(
    Object.entries(asRecord(value) ?? {}).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    )
  );
}

export function summarizeTheme(theme: Rec): ThemeSummary {
  const name = String(theme.name ?? '');
  return {
    name,
    displayName:
      typeof theme.displayName === 'string' ? theme.displayName : name,
    description: typeof theme.description === 'string' ? theme.description : '',
    whenToUse: typeof theme.whenToUse === 'string' ? theme.whenToUse : '',
    extended: theme.typography !== undefined,
  };
}

export function describeTheme(
  theme: Rec,
  format: FormatName
): ThemeDescription {
  const summary = summarizeTheme(theme);
  const fonts = asRecord(theme.fonts) ?? {};
  const system = theme as DesignSystem;
  const palette = designColors(stringMap(theme.colors), system.palette);
  const description: ThemeDescription = {
    ...summary,
    fonts: { heading: family(fonts.heading), body: family(fonts.body) },
    palette: Object.fromEntries(
      Object.entries(palette).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string'
      )
    ),
  };
  if (!summary.extended) return description;
  const canvas = designCanvas(
    format,
    format === 'docx'
      ? (asRecord(theme.page)?.size as string | undefined)
      : undefined
  );
  const roles = resolveTypeRoles(system, canvas, bodySize(theme, format));
  description.typography = {
    roles: Object.fromEntries(
      Object.entries(roles).map(([role, value]) => [role, value.size])
    ),
    ...(system.typography?.scale && {
      scale: Object.fromEntries(
        Object.entries(system.typography.scale).map(([key, scale]) => [
          key,
          {
            base: scale.base,
            ...(scale.ratio !== undefined && { ratio: scale.ratio }),
          },
        ])
      ),
    }),
  };
  if (system.spacing) description.spacing = system.spacing;
  if (system.chrome) description.chrome = Object.keys(system.chrome).sort();
  if (system.motif) description.motif = system.motif.kind;
  return description;
}

/** Every built-in theme of a format, summarised, by name. */
export async function themeSummaries(
  format: FormatName
): Promise<ThemeSummary[]> {
  const themes = (await loadCore(format))?.themes ?? {};
  return Object.keys(themes)
    .sort()
    .map((name) => summarizeTheme({ ...themes[name], name }));
}

/** Every built-in theme of a format, described, by name. */
export async function themeDescriptions(
  format: FormatName
): Promise<ThemeDescription[]> {
  const themes = (await loadCore(format))?.themes ?? {};
  return Object.keys(themes)
    .sort()
    .map((name) => describeTheme({ ...themes[name], name }, format));
}
