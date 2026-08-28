import React, { useId } from 'react';
import { Eye, ShieldAlert, SlidersHorizontal } from 'lucide-react';
import { Label } from '../ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { FORMAT, type FormatName } from '../../lib/env';
import { cn } from '../../lib/utils';
import type { Settings } from '../../lib/types';
import { useSettingsStore } from '../../store/settings-store-provider';

type QualityGate = NonNullable<Settings['qualityGate']>;
type QualityMinSeverity = NonNullable<Settings['qualityMinSeverity']>;

type Choice<T extends string> = {
  value: T;
  label: string;
  description: string;
};

/**
 * Radix refuses an empty option value, and `undefined` is how the store spells
 * "let the format choose", so the default option needs a stand-in id that never
 * reaches the server.
 */
const DEFAULT_PROFILE_VALUE = '__default__';

/**
 * Scoped by format on purpose: a docx profile named on a presentation makes the
 * server reject the whole run as profile-incompatible, so the author must never
 * be able to pick one from the wrong list.
 */
const PROFILES: Record<FormatName, readonly Choice<string>[]> = {
  docx: [
    {
      value: 'executive-report',
      label: 'Executive report',
      description: 'Short decision document with strict outline continuity',
    },
    {
      value: 'technical-report',
      label: 'Technical report',
      description: 'Portable professional report defaults',
    },
    {
      value: 'legal-appendix',
      label: 'Legal appendix',
      description: 'Dense appendix: preserve integrity without editorial taste',
    },
  ],
  pptx: [
    {
      value: 'executive-presentation',
      label: 'Executive presentation',
      description: 'Decision deck optimized for scan speed and projection',
    },
    {
      value: 'technical-presentation',
      label: 'Technical presentation',
      description: 'Portable professional presentation defaults',
    },
  ],
};

/** The profile the server falls back to, so "Default" can name what it means. */
const DEFAULT_PROFILE_ID: Record<FormatName, string> = {
  docx: 'technical-report',
  pptx: 'technical-presentation',
};

/**
 * Every label states the consequence, because the gate is the one control here
 * that turns a report into a failed build.
 */
const GATES: readonly Choice<QualityGate>[] = [
  {
    value: 'none',
    label: 'Never blocks',
    description: 'Findings are reported and the run always finishes',
  },
  {
    value: 'error',
    label: 'Blocks on errors',
    description: 'Generation fails when a finding is an error',
  },
  {
    value: 'warning',
    label: 'Blocks on warnings',
    description: 'Generation fails on any warning or error',
  },
  {
    value: 'info',
    label: 'Blocks on anything',
    description: 'Generation fails on any finding, info included',
  },
];

const MIN_SEVERITIES: readonly Choice<QualityMinSeverity>[] = [
  {
    value: 'error',
    label: 'Errors only',
    description: 'Warnings and info stay hidden',
  },
  {
    value: 'warning',
    label: 'Warnings and errors',
    description: 'Info stays hidden',
  },
  {
    value: 'info',
    label: 'Everything',
    description: 'Every finding the analysis produced',
  },
];

const TRIGGER_CLASS =
  'h-8 min-h-0 w-full gap-1.5 px-2 text-xs [&>span]:truncate [&>span]:whitespace-nowrap';

const CONTENT_CLASS =
  'max-w-[min(20rem,var(--radix-select-content-available-width))]';

const LABEL_CLASS = 'flex items-center gap-1.5 text-xs';

const HELP_CLASS = 'text-[11px] leading-snug text-muted-foreground';

const DEFAULT_PROFILE_CHOICE: Choice<string> = {
  value: DEFAULT_PROFILE_VALUE,
  label: 'Default',
  description: `The format's own profile (${DEFAULT_PROFILE_ID[FORMAT]})`,
};

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
      {children}
    </span>
  );
}

function ChoiceRow({ choice }: { choice: Choice<string> }) {
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="font-medium">{choice.label}</span>
      <span className={HELP_CLASS}>{choice.description}</span>
    </span>
  );
}

/**
 * Profile, gate and display filter for the quality analysis. The gate and the
 * filter get mistaken for each other constantly, so they sit in separate
 * sections instead of forming one row of look-alike dropdowns.
 */
export function QualityControls({
  className,
}: {
  className?: string;
}): React.JSX.Element {
  const fieldId = useId();
  const profileIds = useSettingsStore((s) => s.qualityProfileIds);
  const profileId = profileIds?.[FORMAT];
  const gate = useSettingsStore((s) => s.qualityGate) ?? 'none';
  const minSeverity =
    useSettingsStore((s) => s.qualityMinSeverity) ?? 'warning';
  const setSettings = useSettingsStore((s) => s.setSettings);

  const profiles = PROFILES[FORMAT];
  const storedProfile = profiles.find((choice) => choice.value === profileId);
  const selectedProfile = storedProfile ?? DEFAULT_PROFILE_CHOICE;
  const selectedGate =
    GATES.find((choice) => choice.value === gate) ?? GATES[0];
  const selectedSeverity =
    MIN_SEVERITIES.find((choice) => choice.value === minSeverity) ??
    MIN_SEVERITIES[1];

  return (
    <div className={cn('flex w-full min-w-0 flex-col gap-5', className)}>
      <div className="flex min-w-0 flex-col gap-3">
        <SectionHeading>Run policy</SectionHeading>

        <div className="grid min-w-0 gap-1.5">
          <Label htmlFor={`${fieldId}-profile`} className={LABEL_CLASS}>
            <SlidersHorizontal className="h-3.5 w-3.5 shrink-0 opacity-60" />
            Profile
          </Label>
          <Select
            value={selectedProfile.value}
            onValueChange={(value) =>
              // Written under this format's key only: the other playground's
              // choice lives in the same persisted object and must survive.
              setSettings({
                qualityProfileIds: {
                  ...profileIds,
                  [FORMAT]: value === DEFAULT_PROFILE_VALUE ? undefined : value,
                },
              })
            }
          >
            <SelectTrigger
              id={`${fieldId}-profile`}
              aria-describedby={`${fieldId}-profile-help`}
              className={TRIGGER_CLASS}
            >
              <SelectValue>
                <span className="font-medium">{selectedProfile.label}</span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent className={CONTENT_CLASS}>
              <SelectItem value={DEFAULT_PROFILE_VALUE} className="text-xs">
                <ChoiceRow choice={DEFAULT_PROFILE_CHOICE} />
              </SelectItem>
              {profiles.map((choice) => (
                <SelectItem
                  key={choice.value}
                  value={choice.value}
                  className="text-xs"
                >
                  <ChoiceRow choice={choice} />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p id={`${fieldId}-profile-help`} className={HELP_CLASS}>
            {selectedProfile.description}
          </p>
        </div>

        <div className="grid min-w-0 gap-1.5">
          <Label htmlFor={`${fieldId}-gate`} className={LABEL_CLASS}>
            <ShieldAlert className="h-3.5 w-3.5 shrink-0 opacity-60" />
            Gate
          </Label>
          <Select
            value={selectedGate.value}
            onValueChange={(value) =>
              setSettings({ qualityGate: value as QualityGate })
            }
          >
            <SelectTrigger
              id={`${fieldId}-gate`}
              aria-describedby={`${fieldId}-gate-help`}
              className={TRIGGER_CLASS}
            >
              <SelectValue>
                <span className="font-medium">{selectedGate.label}</span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent className={CONTENT_CLASS}>
              {GATES.map((choice) => (
                <SelectItem
                  key={choice.value}
                  value={choice.value}
                  className="text-xs"
                >
                  <ChoiceRow choice={choice} />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p id={`${fieldId}-gate-help`} className={HELP_CLASS}>
            {selectedGate.description}.
          </p>
        </div>
      </div>

      <div className="h-px shrink-0 bg-border/60" />

      <div className="flex min-w-0 flex-col gap-3">
        <SectionHeading>Panel display</SectionHeading>

        <div className="grid min-w-0 gap-1.5">
          <Label htmlFor={`${fieldId}-severity`} className={LABEL_CLASS}>
            <Eye className="h-3.5 w-3.5 shrink-0 opacity-60" />
            Show
          </Label>
          <Select
            value={selectedSeverity.value}
            onValueChange={(value) =>
              setSettings({ qualityMinSeverity: value as QualityMinSeverity })
            }
          >
            <SelectTrigger
              id={`${fieldId}-severity`}
              aria-describedby={`${fieldId}-severity-help`}
              className={TRIGGER_CLASS}
            >
              <SelectValue>
                <span className="font-medium">{selectedSeverity.label}</span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent className={CONTENT_CLASS}>
              {MIN_SEVERITIES.map((choice) => (
                <SelectItem
                  key={choice.value}
                  value={choice.value}
                  className="text-xs"
                >
                  <ChoiceRow choice={choice} />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p id={`${fieldId}-severity-help`} className={HELP_CLASS}>
            Filters this panel only. It never changes what the run does.
          </p>
        </div>
      </div>
    </div>
  );
}
