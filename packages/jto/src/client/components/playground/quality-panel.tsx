import React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Crosshair,
  Info,
  ShieldAlert,
  Wand2,
  XCircle,
} from 'lucide-react';
import { canApplyFixes } from '../../lib/quality-fixes';
import {
  certaintyLabel,
  countBySeverity,
  filterByMinSeverity,
  groupByCategory,
  type QualityEvidence,
  type QualityFinding,
  type QualitySeverity,
} from '../../lib/quality-findings';
import { cn } from '../../lib/utils';
import type { QualityState } from '../../store/output-store';
import { useSettingsStore } from '../../store/settings-store-provider';
import { Spinner } from '../ui/spinner';

/**
 * The document-quality findings panel.
 *
 * Quality findings used to land in the generic warnings list, where a stock
 * deck's two hundred info-severity notes were all counted and labelled
 * "warnings". Keeping the severities apart is the whole reason this panel
 * exists, so every count it renders is split by severity rather than totalled.
 */

/**
 * Rows mounted before the "Show all" expander takes over. A stock deck
 * produces roughly fifty findings and a dense one over two hundred; mounting
 * every row makes opening the panel visibly janky.
 */
const ROW_CAP = 50;

/** Stable identity so the memos below do not re-run on every parent render. */
const EMPTY_FINDINGS: QualityFinding[] = [];

const SEVERITY_ORDER: readonly QualitySeverity[] = ['error', 'warning', 'info'];

const SEVERITY_ICONS: Record<
  QualitySeverity,
  React.ComponentType<{ className?: string }>
> = {
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const SEVERITY_TEXT: Record<QualitySeverity, string> = {
  error: 'text-destructive',
  warning: 'text-warning',
  info: 'text-data-blue',
};

/** Keys the evidence line renders itself; everything else goes behind details. */
const EVIDENCE_SUMMARY_KEYS = new Set(['actual', 'expected', 'unit']);

/** 'info' is a mass noun, so unlike errors and warnings it takes no plural s. */
function countLabel(severity: QualitySeverity, count: number): string {
  if (severity === 'info') return `${count} info`;
  return `${count} ${severity}${count === 1 ? '' : 's'}`;
}

function formatEvidenceValue(value: unknown, unit: string | undefined): string {
  const base =
    typeof value === 'string'
      ? value
      : typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : JSON.stringify(value);
  return unit ? `${base} ${unit}` : base;
}

/**
 * Evidence keys beyond the actual/expected pair. The server is free to attach
 * its own extras, so the row shows the comparison a reader can act on and
 * hides the rest rather than dumping the object into the list.
 */
function extraEvidence(
  evidence: QualityEvidence | undefined
): Record<string, unknown> | null {
  if (!evidence) return null;
  const rest: Record<string, unknown> = {};
  let found = false;
  for (const [key, value] of Object.entries(evidence)) {
    if (EVIDENCE_SUMMARY_KEYS.has(key)) continue;
    rest[key] = value;
    found = true;
  }
  return found ? rest : null;
}

interface PathChipProps {
  path: string;
  onRevealPath?: (path: string) => void;
  /** Related paths are secondary context, so they render lighter. */
  muted?: boolean;
}

function PathChip({ path, onRevealPath, muted }: PathChipProps) {
  const base = cn(
    'inline-flex max-w-full items-center gap-1 rounded-sm font-mono text-[10px]',
    muted ? 'text-muted-foreground/60' : 'text-muted-foreground/80'
  );

  if (!onRevealPath) {
    return (
      <span className={base}>
        <span className="truncate">{path}</span>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onRevealPath(path)}
      title={`Reveal ${path} in the editor`}
      className={cn(
        base,
        // A pointer is a destination, not a label. The crosshair and the
        // underline on hover are what say so — the old chip read as metadata
        // and nobody discovered it was clickable.
        '-mx-1 px-1 py-0.5 transition-colors',
        'hover:bg-accent hover:text-foreground hover:underline',
        'focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none'
      )}
    >
      <Crosshair className="h-2.5 w-2.5 flex-shrink-0" aria-hidden="true" />
      <span className="truncate">{path}</span>
    </button>
  );
}

interface FindingRowProps {
  finding: QualityFinding;
  onRevealPath?: (path: string) => void;
  onApplyFixes?: (finding: QualityFinding) => void;
  isApplying: boolean;
}

function FindingRow({
  finding,
  onRevealPath,
  onApplyFixes,
  isApplying,
}: FindingRowProps) {
  const Icon = SEVERITY_ICONS[finding.severity] ?? Info;
  const tone = SEVERITY_TEXT[finding.severity] ?? 'text-muted-foreground';
  const certainty = certaintyLabel(finding.certainty);
  const evidence = finding.evidence;
  const hasComparison =
    evidence !== undefined &&
    (evidence.actual !== undefined || evidence.expected !== undefined);
  const rest = extraEvidence(evidence);
  const showFix = Boolean(onApplyFixes) && canApplyFixes(finding.fixes);
  const relatedPaths = finding.relatedPaths ?? [];

  return (
    <div className="rounded-sm border bg-card px-3 py-2.5">
      {/* What is wrong, first and in plain language. The code used to lead
          here, which put the least readable thing in the most prominent slot;
          it is reference data for writing a policy, so it sits in the footer
          with the other machine-readable fields. */}
      <div className="flex items-start gap-2">
        <Icon className={cn('mt-0.5 h-3.5 w-3.5 flex-shrink-0', tone)} />
        <div className="min-w-0 flex-1">
          {finding.blocking && (
            <span className="mr-1.5 rounded-sm bg-destructive/15 px-1 py-0.5 align-[1px] text-[10px] font-medium tracking-wide text-destructive uppercase">
              blocking
            </span>
          )}
          <span className="text-xs leading-relaxed text-foreground">
            {finding.message}
          </span>
        </div>
      </div>

      <div className="mt-1.5 pl-[1.375rem]">
        {/* Expectation before reality, matching how the message reads, and in
            words rather than the `actual · expected` pair that looked like
            debug output. */}
        {hasComparison && evidence && (
          <p className="text-[11px] text-muted-foreground">
            {evidence.expected !== undefined && (
              <>
                Expected{' '}
                <span className="font-mono font-medium text-foreground/90">
                  {formatEvidenceValue(evidence.expected, evidence.unit)}
                </span>
              </>
            )}
            {evidence.expected !== undefined &&
              evidence.actual !== undefined && (
                <span className="text-muted-foreground/50"> · </span>
              )}
            {evidence.actual !== undefined && (
              <>
                {evidence.expected === undefined ? 'Found' : 'found'}{' '}
                <span className="font-mono font-medium text-foreground/90">
                  {formatEvidenceValue(evidence.actual, evidence.unit)}
                </span>
              </>
            )}
          </p>
        )}

        {/* Advice and the button that enacts it are one thing, so they share
            one block. The button used to float in the card's top corner, an
            inch from the sentence explaining what it would do. */}
        {(finding.suggestion || showFix) && (
          <div
            className={cn(
              'mt-1.5 flex items-center gap-2 rounded-sm bg-header-bg/70 px-2 py-1.5',
              !finding.suggestion && 'justify-end'
            )}
          >
            {finding.suggestion && (
              <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-muted-foreground">
                {finding.suggestion}
              </p>
            )}
            {showFix && (
              <button
                type="button"
                onClick={() => onApplyFixes?.(finding)}
                disabled={isApplying}
                className={cn(
                  'flex flex-shrink-0 items-center gap-1 rounded-sm border bg-card px-1.5 py-1',
                  'text-[11px] font-medium text-foreground transition-colors',
                  'hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring',
                  'focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60'
                )}
              >
                {isApplying ? (
                  <Spinner size="sm" variant="muted" className="h-3 w-3" />
                ) : (
                  <Wand2 className="h-3 w-3" aria-hidden="true" />
                )}
                Apply fix
              </button>
            )}
          </div>
        )}

        {/* Where, how sure, and what to call it in a policy. All reference:
            muted, one line, out of the way of the sentence above. The category
            is not repeated here — the group heading above already names it. */}
        <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1">
          {finding.path && (
            <PathChip path={finding.path} onRevealPath={onRevealPath} />
          )}
          {relatedPaths.map((related) => (
            <PathChip
              key={related}
              path={related}
              onRevealPath={onRevealPath}
              muted
            />
          ))}
          {certainty && (
            <span
              className="text-[10px] text-muted-foreground/70"
              title="How the analysis reached this finding"
            >
              {certainty}
            </span>
          )}
          {finding.code && (
            <code className="text-[10px] text-muted-foreground/60">
              {finding.code}
            </code>
          )}
        </div>

        {rest && (
          <details className="mt-1.5">
            <summary className="cursor-pointer text-[11px] text-muted-foreground/70 hover:text-foreground">
              More evidence
            </summary>
            <pre className="mt-1 overflow-x-auto rounded-sm bg-header-bg p-1.5 text-[11px] text-muted-foreground">
              {JSON.stringify(rest, null, 2)}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}

export interface QualityFindingsProps {
  quality: QualityState | null | undefined;
  id?: string;
  className?: string;
  /** Reveal an RFC 6901 path in the active editor. */
  onRevealPath?: (path: string) => void;
  /** Present only when the finding carries applicable fixes. */
  onApplyFixes?: (finding: QualityFinding) => void;
  /** True while a fix is being applied, to disable the button. */
  applyingFindingId?: string | null;
}

/**
 * The findings themselves, without a header of their own.
 *
 * Rendered into a floating drawer rather than into the column: the preview is
 * the thing the author is reading, and a list that pushes the page down moves
 * the document every time the analysis changes.
 */
export function QualityFindings({
  quality,
  id,
  className,
  onRevealPath,
  onApplyFixes,
  applyingFindingId,
}: QualityFindingsProps): React.JSX.Element | null {
  const minSeverity = useSettingsStore((state) => state.qualityMinSeverity);
  const [showAllSeverities, setShowAllSeverities] = React.useState(false);
  const [showAllRows, setShowAllRows] = React.useState(false);

  const findings = quality?.findings ?? EMPTY_FINDINGS;
  const threshold: QualitySeverity = minSeverity ?? 'warning';

  const kept = React.useMemo(
    () => filterByMinSeverity(findings, threshold),
    [findings, threshold]
  );
  const visible = showAllSeverities ? findings : kept;

  const groups = React.useMemo(() => groupByCategory(visible), [visible]);

  const cappedGroups = React.useMemo(() => {
    if (showAllRows || visible.length <= ROW_CAP) return groups;
    let budget = ROW_CAP;
    const out: Array<{ category: string; findings: QualityFinding[] }> = [];
    for (const group of groups) {
      if (budget <= 0) break;
      const slice = group.findings.slice(0, budget);
      budget -= slice.length;
      out.push({ category: group.category, findings: slice });
    }
    return out;
  }, [groups, showAllRows, visible.length]);

  // Counts come from the findings actually held rather than from the server's
  // tally, so the header can never claim severities the body has no rows for.
  // `truncated` is what explains a shortfall against the server's own count.
  const counts = React.useMemo(() => countBySeverity(findings), [findings]);
  const keptCounts = React.useMemo(() => countBySeverity(kept), [kept]);
  const hiddenTotal = findings.length - kept.length;

  const hiddenLabel = React.useMemo(() => {
    const parts: string[] = [];
    let named = 0;
    for (const severity of SEVERITY_ORDER) {
      const n = counts[severity] - keptCounts[severity];
      if (n > 0) {
        parts.push(countLabel(severity, n));
        named += n;
      }
    }
    // Findings carrying a severity this build does not know about are dropped
    // by any threshold, and would otherwise vanish without being accounted for.
    if (named < hiddenTotal) parts.push(`${hiddenTotal - named} other`);
    return parts.join(', ');
  }, [counts, keptCounts, hiddenTotal]);

  // Nothing analysed yet, and nothing to report about a clean document — the
  // summary row above says that in one line.
  if (!quality) return null;
  if (
    findings.length === 0 &&
    !quality.gateError &&
    !quality.analysisError &&
    !quality.truncated
  ) {
    return null;
  }

  return (
    <div id={id} className={cn('space-y-1.5', className)}>
      {/* The gate refused a build the author asked for, so it explains itself
          before any finding. */}
      {quality.gateError && (
        <div className="flex items-start gap-2 rounded-sm border border-destructive/40 bg-destructive/10 px-3 py-2">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-destructive" />
          <p className="text-xs leading-relaxed text-destructive">
            {quality.gateError}
          </p>
        </div>
      )}

      {/* A failed analysis is reported in a neutral tone, and the findings
          below it are the previous ones — stale, but the only true thing left
          on screen. */}
      {quality.analysisError && (
        <div className="flex items-start gap-2 rounded-sm border bg-muted/60 px-3 py-2">
          <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
          <p className="text-xs leading-relaxed text-muted-foreground">
            {quality.analysisError}
            {findings.length > 0 && ' Showing the last completed analysis.'}
          </p>
        </div>
      )}

      <div className="space-y-1.5">
        {quality.truncated && (
          <p className="px-0.5 text-[11px] text-muted-foreground/80">
            The analysis stopped early — not every finding is listed.
          </p>
        )}

        {/* A finding the author cannot discover is worse than one they choose
              to ignore, so the filter always says what it swallowed. */}
        {hiddenTotal > 0 && (
          <div className="flex items-center gap-2 rounded-sm border border-dashed px-3 py-1.5">
            <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
              {showAllSeverities
                ? `${hiddenLabel} below the ${threshold} filter, now shown`
                : `${hiddenLabel} hidden by the ${threshold}-and-above filter`}
            </span>
            <button
              type="button"
              onClick={() => setShowAllSeverities(!showAllSeverities)}
              className={cn(
                'flex-shrink-0 rounded-sm px-1.5 py-0.5 text-[11px] font-medium',
                'text-foreground transition-colors hover:bg-accent',
                'focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none'
              )}
            >
              {showAllSeverities ? 'Hide again' : 'Show all'}
            </button>
          </div>
        )}

        {cappedGroups.map((group) => (
          <div key={group.category} className="space-y-1.5">
            <div className="px-0.5 text-[10px] font-medium tracking-wide text-muted-foreground/70 uppercase">
              {group.category}
            </div>
            {group.findings.map((finding) => (
              <FindingRow
                key={finding.id}
                finding={finding}
                onRevealPath={onRevealPath}
                onApplyFixes={onApplyFixes}
                isApplying={applyingFindingId === finding.id}
              />
            ))}
          </div>
        ))}

        {visible.length > ROW_CAP && (
          <button
            type="button"
            onClick={() => setShowAllRows(!showAllRows)}
            className={cn(
              'w-full rounded-sm border border-dashed px-3 py-1.5 text-[11px]',
              'font-medium text-muted-foreground transition-colors',
              'hover:bg-accent hover:text-foreground',
              'focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none'
            )}
          >
            {showAllRows
              ? `Show first ${ROW_CAP}`
              : `Show all ${visible.length}`}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * True when there is something for the drawer to show.
 *
 * A clean document has a verdict but no detail, so its summary row is a
 * statement rather than a control — offering an empty drawer would be a
 * promise the panel cannot keep.
 */
export function hasQualityDetail(
  quality: QualityState | null | undefined
): boolean {
  if (!quality) return false;
  return (
    quality.findings.length > 0 ||
    Boolean(quality.gateError) ||
    Boolean(quality.analysisError) ||
    Boolean(quality.truncated)
  );
}

export interface QualitySummaryProps {
  quality: QualityState | null | undefined;
  /** Whether the findings drawer is open. */
  open?: boolean;
  onToggle?: () => void;
  /** Id of the drawer, for `aria-controls` while it is open. */
  controlsId?: string;
  className?: string;
}

/**
 * The one-line verdict, sized to sit in a toolbar row.
 *
 * It carries the whole summary — counts by severity, the gate's blocked badge,
 * the profile that ran — so an author never has to open anything to learn
 * where the document stands. The detail is a drawer away.
 */
export function QualitySummary({
  quality,
  open = false,
  onToggle,
  controlsId,
  className,
}: QualitySummaryProps): React.JSX.Element | null {
  const counts = React.useMemo(
    () => countBySeverity(quality?.findings ?? EMPTY_FINDINGS),
    [quality?.findings]
  );

  if (!quality) return null;

  const isRejected = Boolean(quality.blocked || quality.gateError);
  const chips = SEVERITY_ORDER.filter((severity) => counts[severity] > 0);
  const expandable = hasQualityDetail(quality) && Boolean(onToggle);

  const tone = isRejected
    ? 'text-destructive'
    : counts.error > 0
      ? 'text-destructive'
      : counts.warning > 0
        ? 'text-warning'
        : quality.analysisError
          ? 'text-muted-foreground'
          : chips.length === 0
            ? 'text-success'
            : 'text-data-blue';
  const Icon = isRejected
    ? ShieldAlert
    : counts.error > 0
      ? XCircle
      : counts.warning > 0
        ? AlertTriangle
        : quality.analysisError
          ? Info
          : chips.length === 0
            ? CheckCircle2
            : Info;

  const content = (
    <>
      {expandable && (
        <ChevronRight
          className={cn(
            'h-3.5 w-3.5 flex-shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-90'
          )}
          aria-hidden="true"
        />
      )}
      <Icon className={cn('h-3.5 w-3.5 flex-shrink-0', tone)} />
      <span className="text-xs font-medium text-foreground">Quality</span>
      {chips.length === 0 ? (
        <span className="truncate text-xs text-muted-foreground">
          {quality.analysisError ? 'Not available' : 'No findings'}
        </span>
      ) : (
        chips.map((severity, index) => (
          <React.Fragment key={severity}>
            {index > 0 && (
              <span aria-hidden="true" className="text-muted-foreground/40">
                ·
              </span>
            )}
            <span
              className={cn('text-xs font-medium', SEVERITY_TEXT[severity])}
            >
              {countLabel(severity, counts[severity])}
            </span>
          </React.Fragment>
        ))
      )}
      {isRejected && (
        <span className="flex-shrink-0 rounded-sm bg-destructive/15 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-destructive uppercase">
          blocked
        </span>
      )}
      {quality.profileId && (
        <span
          className="ml-auto truncate pl-2 font-mono text-[10px] text-muted-foreground"
          title={`Quality profile: ${quality.profileId}`}
        >
          {quality.profileId}
        </span>
      )}
    </>
  );

  const shared = 'flex min-w-0 items-center gap-2 rounded-sm px-1.5 py-0.5';

  // A clean verdict is not a control: there is nothing behind it to open.
  if (!expandable) {
    return <div className={cn(shared, className)}>{content}</div>;
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={open ? controlsId : undefined}
      className={cn(
        shared,
        'text-left transition-colors hover:bg-accent',
        'focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none',
        className
      )}
    >
      {content}
    </button>
  );
}
