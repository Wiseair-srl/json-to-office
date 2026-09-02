import React, { useCallback, useMemo } from 'react';
import { FORMAT } from '../../lib/env';
import {
  DOCX_FONT_ROLES,
  FONT_ROLE_HINTS,
  PPTX_FONT_ROLES,
  getAt,
  resolveColor,
  type ThemeJson,
} from '../../lib/theme-editor/model';
import {
  DraftNumberInput,
  EditorSection,
  FIELD_LABEL_CLASS,
  GroupLabel,
  HINT_CLASS,
  useThemeEditor,
} from './theme-editor-shared';
import { ColorControl, useThemeColorTokens } from './color-picker';
import { FamilyCombobox } from './font-combobox';

/**
 * docx fonts are roles — heading, body, mono, light — each a family and a
 * size the styles inherit. pptx fonts are two family strings, and the
 * sizes live in `defaults`, so the section takes a different shape per
 * format rather than pretending the two agree.
 */

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

const DocxRoleCard = React.memo(function DocxRoleCard({
  role,
  family,
  size,
}: {
  role: string;
  family: string | undefined;
  size: number | undefined;
}) {
  const { set, remove } = useThemeEditor();
  const commitFamily = useCallback(
    (next: string | null) =>
      next === null
        ? remove(['fonts', role, 'family'])
        : set(['fonts', role, 'family'], next),
    [remove, role, set]
  );
  const commitSize = useCallback(
    (next: number | null) =>
      next === null
        ? remove(['fonts', role, 'size'])
        : set(['fonts', role, 'size'], next),
    [remove, role, set]
  );
  const familyId = `theme-font-${role}-family`;
  const sizeId = `theme-font-${role}-size`;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_6.5rem] gap-x-2 gap-y-1 rounded-sm border border-border/70 p-2">
      <div className="col-span-2 flex items-baseline gap-2">
        <span className="text-sm capitalize">{role}</span>
        <span className={HINT_CLASS}>{FONT_ROLE_HINTS[role]}</span>
      </div>
      <label htmlFor={familyId} className={FIELD_LABEL_CLASS}>
        Family
      </label>
      <label htmlFor={sizeId} className={FIELD_LABEL_CLASS}>
        Size
      </label>
      <FamilyCombobox
        id={familyId}
        label={`${role} family`}
        value={family}
        onCommit={commitFamily}
        pickerPath={['fonts', role, 'family']}
      />
      <DraftNumberInput
        id={sizeId}
        aria-label={`${role} size`}
        value={size}
        onCommit={commitSize}
        unit="pt"
        min={8}
        max={120}
        step={0.5}
      />
    </div>
  );
});

const PptxFamilyRow = React.memo(function PptxFamilyRow({
  role,
  family,
}: {
  role: string;
  family: string | undefined;
}) {
  const { set, remove } = useThemeEditor();
  const commit = useCallback(
    (next: string | null) =>
      next === null ? remove(['fonts', role]) : set(['fonts', role], next),
    [remove, role, set]
  );
  const id = `theme-font-${role}`;
  return (
    <div className="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-2">
      <label htmlFor={id} className="flex flex-col">
        <span className="text-sm capitalize">{role}</span>
        <span className={HINT_CLASS}>{FONT_ROLE_HINTS[role]}</span>
      </label>
      <FamilyCombobox
        id={id}
        label={`${role} family`}
        value={family}
        onCommit={commit}
        pickerPath={['fonts', role]}
      />
    </div>
  );
});

function PptxDefaults({ theme }: { theme: ThemeJson }) {
  const { set, remove } = useThemeEditor();
  const fontSize = asNumber(getAt(theme, ['defaults', 'fontSize']));
  const fontColor = asString(getAt(theme, ['defaults', 'fontColor']));
  const resolved = useMemo(
    () => resolveColor(theme, fontColor),
    [theme, fontColor]
  );
  const tokens = useThemeColorTokens(theme);
  const commitSize = useCallback(
    (next: number | null) =>
      next === null
        ? remove(['defaults', 'fontSize'])
        : set(['defaults', 'fontSize'], next),
    [remove, set]
  );
  const commitColor = useCallback(
    (next: string | null) =>
      next === null
        ? remove(['defaults', 'fontColor'])
        : set(['defaults', 'fontColor'], next),
    [remove, set]
  );
  return (
    <div className="flex flex-col gap-2">
      <GroupLabel>Defaults</GroupLabel>
      <p className={HINT_CLASS}>
        What text falls back to when no style says otherwise.
      </p>
      <div className="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-2">
        <label htmlFor="theme-defaults-size" className="text-sm">
          Font size
        </label>
        <DraftNumberInput
          id="theme-defaults-size"
          value={fontSize}
          onCommit={commitSize}
          unit="pt"
          min={1}
          max={200}
          step={1}
          className="max-w-[7rem]"
        />
        <label htmlFor="theme-defaults-color" className="text-sm">
          Font colour
        </label>
        <ColorControl
          id="theme-defaults-color"
          label="Default font colour"
          value={fontColor}
          resolved={resolved}
          onCommit={commitColor}
          allowReference={false}
          tokens={tokens}
          className="max-w-[12rem]"
        />
      </div>
    </div>
  );
}

export function ThemeTypographySection({ theme }: { theme: ThemeJson }) {
  if (FORMAT === 'docx') {
    return (
      <EditorSection
        title="Typography"
        hint="Four roles the styles point at. A family beyond the safe list needs a fontRegistry entry on the document to embed; the specimen shows what the browser has."
      >
        <div className="grid grid-cols-1 gap-2 @[34rem]:grid-cols-2">
          {DOCX_FONT_ROLES.map((role) => {
            const font = getAt(theme, ['fonts', role]);
            const record =
              font && typeof font === 'object'
                ? (font as Record<string, unknown>)
                : undefined;
            return (
              <DocxRoleCard
                key={role}
                role={role}
                family={asString(record?.family)}
                size={asNumber(record?.size)}
              />
            );
          })}
        </div>
      </EditorSection>
    );
  }
  return (
    <EditorSection
      title="Typography"
      hint="Two families; every style uses one or names its own face."
    >
      <div className="flex flex-col gap-2">
        {PPTX_FONT_ROLES.map((role) => (
          <PptxFamilyRow
            key={role}
            role={role}
            family={asString(getAt(theme, ['fonts', role]))}
          />
        ))}
      </div>
      <PptxDefaults theme={theme} />
    </EditorSection>
  );
}
