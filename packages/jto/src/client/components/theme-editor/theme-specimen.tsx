import React, { useEffect, useMemo } from 'react';
import { FORMAT } from '../../lib/env';
import {
  getAt,
  resolveColor,
  type ThemeJson,
} from '../../lib/theme-editor/model';
import { ensureGoogleFontLoaded } from '../../lib/font-face-inject';
import { useFontCatalog } from './theme-editor-shared';

/**
 * The theme, rendered by the browser: the named styles as type, a table,
 * the chart palette. It answers "what does this look like" between edits
 * without a round trip; the real render is one click away in the host.
 *
 * It resolves colours and fonts the way the compilers do - a style's colour
 * may name a token, a docx style names a font role, a pptx one a face - but
 * it is a sketch, not the pipeline. Where a theme leaves something unset it
 * falls back to what the compilers default to.
 */

interface SpecimenText {
  family: string;
  sizePx: number;
  color: string;
  bold: boolean;
  italic: boolean;
  mono: boolean;
}

interface SpecimenModel {
  background: string;
  text: string;
  border: string;
  stripe: string;
  primary: string;
  headerText: string;
  palette: { key: string; hex: string }[];
  title: SpecimenText;
  heading1: SpecimenText;
  heading2: SpecimenText;
  body: SpecimenText;
  caption: SpecimenText;
  families: { role: string; family: string }[];
}

const FALLBACK = {
  background: '#FFFFFF',
  text: '#1F2937',
  border: '#D1D5DB',
  primary: '#1F2937',
};

/** Points to pixels at a reduced scale so a 44pt title fits a 260px card. */
function ptToPx(pt: number): number {
  return Math.min(34, Math.max(11, Math.round(pt * 0.75)));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function isBold(style: Record<string, unknown> | undefined): boolean {
  if (!style) return false;
  const weight = asNumber(style.fontWeight);
  if (weight !== undefined) return weight >= 600;
  return style.bold === true;
}

/** docx: a style names a font role; the role carries family and size. */
function docxText(
  theme: ThemeJson,
  styleName: string,
  defaultRole: string,
  defaultSize: number,
  fallbackColor: string
): SpecimenText {
  const style = asRecord(getAt(theme, ['styles', styleName]));
  const role = asString(style?.font) ?? defaultRole;
  const font = asRecord(getAt(theme, ['fonts', role]));
  const family = asString(font?.family) ?? 'sans-serif';
  const size = asNumber(style?.size) ?? asNumber(font?.size) ?? defaultSize;
  const color =
    resolveColor(theme, style?.color) ??
    resolveColor(theme, font?.color) ??
    fallbackColor;
  return {
    family,
    sizePx: ptToPx(size),
    color,
    bold: isBold(style) || (style === undefined && isBold(font)),
    italic: style?.italic === true,
    mono: role === 'mono',
  };
}

/** pptx: fonts are plain family strings; sizes come from defaults. */
function pptxText(
  theme: ThemeJson,
  styleName: string,
  defaultRole: 'heading' | 'body',
  defaultSize: number,
  fallbackColor: string
): SpecimenText {
  const style = asRecord(getAt(theme, ['styles', styleName]));
  const family =
    asString(style?.fontFace) ??
    asString(getAt(theme, ['fonts', defaultRole])) ??
    'sans-serif';
  const size =
    asNumber(style?.fontSize) ??
    asNumber(getAt(theme, ['defaults', 'fontSize'])) ??
    defaultSize;
  const color =
    resolveColor(theme, style?.fontColor) ??
    resolveColor(theme, getAt(theme, ['defaults', 'fontColor'])) ??
    fallbackColor;
  return {
    family,
    sizePx: ptToPx(size),
    color,
    bold: isBold(style),
    italic: style?.italic === true,
    mono: false,
  };
}

const PALETTE_KEYS = [
  'primary',
  'secondary',
  'accent',
  'accent4',
  'accent5',
  'accent6',
];

function buildModel(theme: ThemeJson): SpecimenModel {
  const colors = asRecord(theme.colors) ?? {};
  const resolve = (key: string) => resolveColor(theme, colors[key]);
  const background = resolve('background') ?? FALLBACK.background;
  const text = resolve('text') ?? FALLBACK.text;
  const border =
    resolve('border') ??
    resolve('background2') ??
    resolve('borderPrimary') ??
    FALLBACK.border;
  const stripe =
    resolve('backgroundSecondary') ?? resolve('background2') ?? background;
  const primary = resolve('primary') ?? FALLBACK.primary;
  const muted =
    resolve('textMuted') ??
    resolve('text2') ??
    resolve('textSecondary') ??
    text;

  const palette = PALETTE_KEYS.map((key) => ({
    key,
    hex: resolve(key),
  })).filter((entry): entry is { key: string; hex: string } => !!entry.hex);

  const docx = FORMAT === 'docx';
  const title = docx
    ? docxText(theme, 'title', 'heading', 28, primary)
    : pptxText(theme, 'title', 'heading', 40, primary);
  const heading1 = docx
    ? docxText(theme, 'heading1', 'heading', 20, primary)
    : pptxText(theme, 'heading1', 'heading', 32, primary);
  const heading2 = docx
    ? docxText(theme, 'heading2', 'heading', 16, primary)
    : pptxText(theme, 'heading2', 'heading', 24, primary);
  const body = docx
    ? docxText(theme, 'normal', 'body', 11, text)
    : pptxText(theme, 'body', 'body', 16, text);
  // docx has no caption style slot: the muted colour on the body face is
  // what a caption component renders with.
  const caption = docx
    ? { ...body, sizePx: 11, color: muted, bold: false }
    : pptxText(theme, 'caption', 'body', 11, muted);

  const families: { role: string; family: string }[] = [];
  const fonts = asRecord(theme.fonts) ?? {};
  for (const role of Object.keys(fonts)) {
    const family = docx
      ? asString(asRecord(fonts[role])?.family)
      : asString(fonts[role]);
    if (family) families.push({ role, family });
  }

  return {
    background,
    text,
    border,
    stripe,
    primary,
    headerText: background,
    palette,
    title,
    heading1,
    heading2,
    body,
    caption,
    families,
  };
}

function fontStack(family: string, mono: boolean): string {
  const quoted = `"${family.replace(/"/g, '')}"`;
  return mono
    ? `${quoted}, ui-monospace, "SF Mono", Menlo, monospace`
    : `${quoted}, "Inter Variable", system-ui, sans-serif`;
}

function Line({
  text,
  children,
  block,
}: {
  text: SpecimenText;
  children: React.ReactNode;
  block?: boolean;
}) {
  return (
    <div
      className={block ? 'leading-snug' : 'truncate leading-tight'}
      style={{
        fontFamily: fontStack(text.family, text.mono),
        fontSize: text.sizePx,
        color: text.color,
        fontWeight: text.bold ? 700 : 400,
        fontStyle: text.italic ? 'italic' : 'normal',
      }}
    >
      {children}
    </div>
  );
}

const TABLE_ROWS: [string, string, string][] = [
  ['Region', 'Q1', 'Q2'],
  ['North', '1,240', '1,385'],
  ['South', '980', '1,102'],
];

export function ThemeSpecimen({ theme }: { theme: ThemeJson }) {
  const model = useMemo(() => buildModel(theme), [theme]);
  const catalog = useFontCatalog();

  // Families the OS already has cost a failed stylesheet request each; skip
  // the ones the catalog knows to be safe once it has loaded.
  const familyKey = model.families.map((f) => f.family).join('\n');
  useEffect(() => {
    const safe = new Set(catalog.safe.map((f) => f.toLowerCase()));
    for (const family of new Set(familyKey.split('\n'))) {
      if (family && !safe.has(family.toLowerCase())) {
        ensureGoogleFontLoaded(family);
      }
    }
  }, [familyKey, catalog.safe]);

  return (
    <div
      aria-label="Theme sample"
      title="Approximate: the browser's rendering of the theme. Run sample to see the real output."
      className="@container overflow-hidden rounded-md border"
      style={{ background: model.background, color: model.text }}
    >
      <div className="grid max-h-[260px] grid-cols-1 gap-x-5 gap-y-3 p-4 @[30rem]:grid-cols-[1.3fr_1fr]">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Line text={model.title}>Annual report</Line>
          <Line text={model.heading1}>1. Executive summary</Line>
          <Line text={model.heading2}>1.1 Where the year landed</Line>
          <Line text={model.body} block>
            Body text in the theme&apos;s body face, sized as the document sets
            it. A second sentence lets the line spacing and colour read.
          </Line>
          <Line text={model.caption}>
            Figure 1 - a caption in the muted colour
          </Line>
        </div>

        <div className="flex min-w-0 flex-col justify-between gap-3">
          <table
            className="w-full border-collapse"
            style={{
              fontFamily: fontStack(model.body.family, false),
              fontSize: Math.max(10, model.body.sizePx - 1),
            }}
          >
            <tbody>
              {TABLE_ROWS.map((row, index) => (
                <tr
                  key={row[0]}
                  style={{
                    background:
                      index === 0
                        ? model.primary
                        : index % 2 === 0
                          ? model.stripe
                          : 'transparent',
                    color: index === 0 ? model.headerText : model.text,
                    fontWeight: index === 0 ? 600 : 400,
                  }}
                >
                  {row.map((cell, cellIndex) => (
                    <td
                      key={cell}
                      className="px-2 py-1 leading-tight"
                      style={{
                        borderBottom: `1px solid ${model.border}`,
                        textAlign: cellIndex === 0 ? 'left' : 'right',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex flex-col gap-1.5">
            <div className="flex gap-1.5" aria-label="Chart palette">
              {model.palette.map((entry) => (
                <span
                  key={entry.key}
                  title={`${entry.key} ${entry.hex}`}
                  className="h-5 flex-1 rounded-sm"
                  style={{
                    background: entry.hex,
                    boxShadow: `inset 0 0 0 1px ${model.border}`,
                  }}
                />
              ))}
              {model.palette.length === 0 && (
                <span className="text-[11px] opacity-60">No palette yet</span>
              )}
            </div>
            {model.families.length > 0 && (
              <p className="truncate text-[10px] opacity-60">
                {model.families
                  .map((f) => `${f.role}: ${f.family}`)
                  .join(' / ')}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export const ThemeSpecimenMemoized = React.memo(ThemeSpecimen);
