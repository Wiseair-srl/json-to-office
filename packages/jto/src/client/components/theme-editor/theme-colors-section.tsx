import React, { useCallback, useMemo } from 'react';
import { CornerDownRight } from 'lucide-react';
import { FORMAT } from '../../lib/env';
import {
  colorTokens,
  contrastRatio,
  isHexColor,
  resolveColor,
  type ColorTokenDescriptor,
  type ThemeJson,
} from '../../lib/theme-editor/model';
import { cn } from '../../lib/utils';
import {
  ClearButton,
  ContrastBadge,
  EditorSection,
  GroupLabel,
  HINT_CLASS,
  useThemeEditor,
} from './theme-editor-shared';
import {
  ColorControl,
  useThemeColorTokens,
  type ColorToken,
} from './color-picker';
import { matchesQuery } from '../../lib/theme-editor/schema-form';

/**
 * One row per token the schema declares, in the schema's groups. A token may
 * hold a hex or the name of another token; the row shows the resolved swatch
 * either way and says where a reference points, so `accent5: "primary"`
 * never looks like a colour of its own.
 */

const TOKENS = colorTokens(FORMAT);
const GROUPS = Array.from(new Set(TOKENS.map((t) => t.group)));

interface RowState {
  raw: string | undefined;
  resolved: string | null;
  /** The token a reference points at; null for a hex or nothing. */
  reference: string | null;
  error: string | null;
}

function rowState(theme: ThemeJson, token: ColorTokenDescriptor): RowState {
  const colors = theme.colors as Record<string, unknown> | undefined;
  const value = colors?.[token.key];
  const raw = typeof value === 'string' ? value : undefined;
  const resolved = resolveColor(theme, raw);
  const reference =
    raw !== undefined && !isHexColor(raw) && resolved ? raw : null;
  let error: string | null = null;
  if (raw === undefined && value !== undefined) error = 'Must be a string';
  else if (raw === undefined && token.required) error = 'Required';
  else if (raw !== undefined && !resolved) {
    error = /^[a-zA-Z][a-zA-Z0-9]*$/.test(raw)
      ? `No token named "${raw}"`
      : 'Not a hex colour';
  }
  return { raw, resolved, reference, error };
}

const ColorRow = React.memo(function ColorRow({
  token,
  raw,
  resolved,
  reference,
  error,
  tokens,
}: { token: ColorTokenDescriptor; tokens: readonly ColorToken[] } & RowState) {
  const { set, remove } = useThemeEditor();
  const commit = useCallback(
    (next: string | null) => {
      if (next === null) remove(['colors', token.key]);
      else set(['colors', token.key], next);
    },
    [remove, set, token.key]
  );
  const clear = useCallback(
    () => remove(['colors', token.key]),
    [remove, token.key]
  );
  const inputId = `theme-color-${token.key}`;
  return (
    <div className="flex min-h-8 items-center gap-2">
      <ColorControl
        id={inputId}
        label={token.label}
        value={raw}
        resolved={resolved}
        onCommit={commit}
        tokens={tokens}
        // Narrow panes give the width back to the token name and its
        // hint; a hex needs 96px and no more.
        className="w-[8.5rem] shrink-0 @[30rem]:w-[10.5rem]"
      />
      <div className="flex min-w-0 flex-1 flex-col justify-center">
        <div className="flex min-w-0 items-center gap-1.5">
          <label htmlFor={inputId} className="truncate text-sm">
            {token.label}
          </label>
          <code className="truncate text-[10px] text-muted-foreground">
            {token.key}
          </code>
          {token.required && (
            <span className="shrink-0 rounded-sm bg-muted px-1 text-[10px] tracking-wide text-muted-foreground uppercase">
              required
            </span>
          )}
        </div>
        <p className={cn(HINT_CLASS, 'truncate')}>
          {error ? (
            <span className="text-destructive">{error}</span>
          ) : reference ? (
            <span className="inline-flex items-center gap-1">
              <CornerDownRight className="size-3" aria-hidden />
              <code>{reference}</code>
              <span>{resolved}</span>
            </span>
          ) : (
            token.hint
          )}
        </p>
      </div>
      {raw !== undefined && !token.required ? (
        <ClearButton label={`Clear ${token.label}`} onClick={clear} />
      ) : (
        <span className="size-6 shrink-0" aria-hidden />
      )}
    </div>
  );
});

export function ThemeColorsSection({
  theme,
  query = '',
}: {
  theme: ThemeJson;
  query?: string;
}) {
  const searching = query.trim() !== '';
  const rows = useMemo(
    () =>
      TOKENS.filter(
        (token) =>
          matchesQuery(query, 'colours', 'colors') ||
          matchesQuery(query, token.key, token.label, token.group, token.hint)
      ).map((token) => ({ token, ...rowState(theme, token) })),
    [query, theme]
  );

  const contrast = useMemo(() => {
    const colors = theme.colors as Record<string, unknown> | undefined;
    const background = resolveColor(theme, colors?.background);
    const text = resolveColor(theme, colors?.text);
    const primary = resolveColor(theme, colors?.primary);
    return {
      text: background && text ? contrastRatio(text, background) : null,
      primary:
        background && primary ? contrastRatio(primary, background) : null,
    };
  }, [theme]);

  // Chips inside each picker: every colour this theme already resolves, so a
  // token can be reused without leaving the row it is being set on.
  const tokens = useThemeColorTokens(theme);
  const defined = rows.filter((r) => r.raw !== undefined).length;
  if (searching && rows.length === 0) return null;

  return (
    <EditorSection
      title="Colours"
      hint="Hex values, or the name of another token to reuse it. Required tokens are what the compiler reads directly; the rest are optional slots."
      forceOpen={searching ? true : undefined}
      actions={
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {defined}/{TOKENS.length}
        </span>
      }
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <ContrastBadge label="Text on background" ratio={contrast.text} />
        <ContrastBadge label="Primary on background" ratio={contrast.primary} />
      </div>
      {GROUPS.filter((group) =>
        rows.some((row) => row.token.group === group)
      ).map((group) => (
        <div key={group} className="flex flex-col gap-1">
          <GroupLabel>{group}</GroupLabel>
          {rows
            .filter((row) => row.token.group === group)
            .map((row) => (
              <ColorRow
                key={row.token.key}
                token={row.token}
                raw={row.raw}
                resolved={row.resolved}
                reference={row.reference}
                error={row.error}
                tokens={tokens}
              />
            ))}
        </div>
      ))}
    </EditorSection>
  );
}
