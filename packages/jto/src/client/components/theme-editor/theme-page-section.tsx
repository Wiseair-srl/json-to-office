import React, { useCallback, useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import {
  MARGIN_KEYS,
  PAGE_SIZES,
  getAt,
  twipsToUnit,
  unitToTwips,
  type LengthUnit,
  type Path,
  type ThemeJson,
} from '../../lib/theme-editor/model';
import {
  DraftNumberInput,
  EditorSection,
  FIELD_LABEL_CLASS,
  SELECT_TRIGGER_CLASS,
  useThemeEditor,
} from './theme-editor-shared';
import { matchesQuery } from '../../lib/theme-editor/schema-form';

/**
 * docx only. The JSON stores twips because Word does; nobody thinks in
 * twips, so the fields show the author's unit and convert on the way in
 * and out. The unit is a view setting, never written to the theme.
 */

const CUSTOM = '__custom__';
const UNITS: readonly { value: LengthUnit; label: string }[] = [
  { value: 'in', label: 'in' },
  { value: 'cm', label: 'cm' },
  { value: 'pt', label: 'pt' },
  { value: 'twips', label: 'twips' },
];
const STEP: Record<LengthUnit, number> = {
  in: 0.05,
  cm: 0.1,
  pt: 1,
  twips: 10,
};

/** Module-level paths so the memoised fields see the same array each render. */
const MARGIN_PATHS: Record<string, Path> = Object.fromEntries(
  MARGIN_KEYS.map((key) => [key, ['page', 'margins', key]])
);
const WIDTH_PATH: Path = ['page', 'size', 'width'];
const HEIGHT_PATH: Path = ['page', 'size', 'height'];

function twips(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

/** A length in twips at `path`, edited in `unit`. */
const LengthField = React.memo(function LengthField({
  id,
  label,
  path,
  value,
  unit,
}: {
  id: string;
  label: string;
  path: Path;
  value: number | undefined;
  unit: LengthUnit;
}) {
  const { set, remove } = useThemeEditor();
  const commit = useCallback(
    (next: number | null) =>
      next === null ? remove(path) : set(path, unitToTwips(next, unit)),
    [path, remove, set, unit]
  );
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={FIELD_LABEL_CLASS}>
        {label}
      </label>
      <DraftNumberInput
        id={id}
        value={value === undefined ? undefined : twipsToUnit(value, unit)}
        onCommit={commit}
        unit={unit}
        min={0}
        step={STEP[unit]}
      />
    </div>
  );
});

export function ThemePageSection({
  theme,
  query = '',
}: {
  theme: ThemeJson;
  query?: string;
}) {
  const searching = query.trim() !== '';
  if (
    searching &&
    !matchesQuery(
      query,
      'page',
      'size',
      'margins',
      'width',
      'height',
      ...MARGIN_KEYS,
      ...PAGE_SIZES
    )
  )
    return null;
  const { set } = useThemeEditor();
  const [unit, setUnit] = useState<LengthUnit>('in');

  const size = getAt(theme, ['page', 'size']);
  const isCustom = !!size && typeof size === 'object';
  const sizeValue =
    typeof size === 'string' && (PAGE_SIZES as readonly string[]).includes(size)
      ? size
      : isCustom
        ? CUSTOM
        : '';

  const onSizeChange = useCallback(
    (next: string) => {
      if (next === CUSTOM) {
        // Start the custom box from A4 so the fields are never blank.
        set(['page', 'size'], { width: 11906, height: 16838 });
      } else {
        set(['page', 'size'], next);
      }
    },
    [set]
  );

  return (
    <EditorSection
      title="Page"
      hint="Paper and margins. Stored in twips (1/1440 in); shown in the unit you pick here."
      forceOpen={searching ? true : undefined}
      actions={
        <Select value={unit} onValueChange={(v) => setUnit(v as LengthUnit)}>
          <SelectTrigger
            aria-label="Length unit"
            className="h-6 min-h-0 w-auto gap-1 border-transparent bg-transparent px-1.5 text-[11px] shadow-none hover:bg-accent"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {UNITS.map((u) => (
              <SelectItem key={u.value} value={u.value} className="text-xs">
                {u.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    >
      <div className="grid grid-cols-[6rem_minmax(0,12rem)] items-center gap-2">
        <label htmlFor="theme-page-size" className="text-sm">
          Size
        </label>
        <Select value={sizeValue} onValueChange={onSizeChange}>
          <SelectTrigger id="theme-page-size" className={SELECT_TRIGGER_CLASS}>
            <SelectValue placeholder="Choose a size" />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZES.map((name) => (
              <SelectItem key={name} value={name} className="text-xs">
                {name}
              </SelectItem>
            ))}
            <SelectItem value={CUSTOM} className="text-xs">
              Custom
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isCustom && (
        <div className="grid grid-cols-2 gap-2 @[34rem]:max-w-[24rem]">
          <LengthField
            id="theme-page-width"
            label="Width"
            path={WIDTH_PATH}
            value={twips(getAt(theme, WIDTH_PATH))}
            unit={unit}
          />
          <LengthField
            id="theme-page-height"
            label="Height"
            path={HEIGHT_PATH}
            value={twips(getAt(theme, HEIGHT_PATH))}
            unit={unit}
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 @[30rem]:grid-cols-4">
        {MARGIN_KEYS.map((key) => (
          <LengthField
            key={key}
            id={`theme-margin-${key}`}
            label={key.charAt(0).toUpperCase() + key.slice(1)}
            path={MARGIN_PATHS[key]}
            value={twips(getAt(theme, MARGIN_PATHS[key]))}
            unit={unit}
          />
        ))}
      </div>
    </EditorSection>
  );
}
