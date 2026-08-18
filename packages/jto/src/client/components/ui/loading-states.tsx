import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { Spinner } from './spinner';
import { Skeleton } from './skeleton';
import { Button } from './button';

interface LoadingOverlayProps {
  isLoading: boolean;
  children: React.ReactNode;
  message?: string;
  className?: string;
}

export function LoadingOverlay({
  isLoading,
  children,
  message = 'Loading...',
  className,
}: LoadingOverlayProps) {
  return (
    <div className={cn('relative', className)}>
      {children}
      {isLoading && (
        <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="flex flex-col items-center gap-2">
            <Spinner size="lg" />
            <p className="text-sm text-muted-foreground">{message}</p>
          </div>
        </div>
      )}
    </div>
  );
}

interface DocumentGenerationLoaderProps {
  className?: string;
  currentStage?: 'parsing' | 'building' | 'rendering' | 'finalizing';
  message?: string;
  /** Source JSON of the document being built — drives the content summary. */
  documentText?: string;
  /** Date.now() when the build started — drives the elapsed timer. */
  startedAt?: number;
  /** When provided, renders a Cancel button that aborts the build. */
  onCancel?: () => void;
}

/** Ticks every 100ms and returns whole elapsed seconds since `startedAt`. */
function useElapsedSeconds(startedAt?: number): number {
  // Freeze the fallback start on first render so a caller that never passes
  // `startedAt` still gets a stable timer instead of one reset per render.
  const [fallbackStart] = useState(() => Date.now());
  const start = startedAt ?? fallbackStart;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, []);
  return Math.max(0, (now - start) / 1000);
}

interface DocumentSummary {
  title?: string;
  counts: { label: string; count: number }[];
  visualCount: number;
  imageCount: number;
}

/**
 * Walk a JTO document tree and count the component types worth narrating.
 * Best-effort: any parse/shape surprise returns null and the loader simply
 * omits the summary row.
 */
function summarizeDocument(text?: string): DocumentSummary | null {
  if (!text) return null;
  try {
    const root = JSON.parse(text);
    if (!root || typeof root !== 'object') return null;
    const counts = new Map<string, number>();
    const stack: unknown[] = [root];
    while (stack.length > 0) {
      const node = stack.pop();
      if (!node || typeof node !== 'object') continue;
      const { name, children } = node as {
        name?: unknown;
        children?: unknown;
      };
      if (typeof name === 'string') {
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
      if (Array.isArray(children)) stack.push(...children);
    }
    // Ordered by how much each type usually tells the user about build cost.
    const interesting: [key: string, singular: string, plural: string][] = [
      ['slide', 'slide', 'slides'],
      ['section', 'section', 'sections'],
      ['visual', 'visual', 'visuals'],
      ['chart', 'chart', 'charts'],
      ['image', 'image', 'images'],
      ['table', 'table', 'tables'],
      ['shape', 'shape', 'shapes'],
      ['paragraph', 'paragraph', 'paragraphs'],
    ];
    const summary = interesting
      .map(([key, singular, plural]) => {
        const count = counts.get(key) ?? 0;
        return { label: count === 1 ? singular : plural, count };
      })
      .filter((entry) => entry.count > 0)
      .slice(0, 5);
    const title = (root as { props?: { metadata?: { title?: unknown } } }).props
      ?.metadata?.title;
    return {
      title: typeof title === 'string' ? title : undefined,
      counts: summary,
      visualCount: (counts.get('visual') ?? 0) + (counts.get('chart') ?? 0),
      imageCount: counts.get('image') ?? 0,
    };
  } catch {
    return null;
  }
}

/** Rotating context lines shown once a build takes more than a moment. */
function buildHints(summary: DocumentSummary | null): string[] {
  const hints: string[] = [];
  if (summary && summary.visualCount > 0) {
    hints.push(
      `${summary.visualCount} visual${summary.visualCount === 1 ? '' : 's'} in this document ${
        summary.visualCount === 1 ? 'is' : 'are'
      } rasterized on first build — later builds reuse the cached renders.`
    );
  }
  if (summary && summary.imageCount > 3) {
    hints.push(
      'Large embedded images dominate build time — downscaling them speeds up iteration.'
    );
  }
  hints.push(
    'Re-running an unchanged document is served from the cache almost instantly.',
    'Generation warnings, if any, will appear above the preview when the build completes.'
  );
  return hints;
}

const CheckIcon = () => (
  <svg
    className="h-3.5 w-3.5 text-success"
    viewBox="0 0 16 16"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M3 8.5L6.5 12L13 4.5"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export function DocumentGenerationLoader({
  className,
  currentStage = 'parsing',
  message,
  documentText,
  startedAt,
  onCancel,
}: DocumentGenerationLoaderProps) {
  const stages = ['parsing', 'building', 'rendering', 'finalizing'] as const;
  const stageLabels: Record<(typeof stages)[number], string> = {
    parsing: 'Validating JSON',
    building: 'Building structure',
    rendering: 'Rendering content',
    finalizing: 'Finalizing document',
  };

  const currentStageIndex = stages.indexOf(currentStage);
  const elapsed = useElapsedSeconds(startedAt);
  const summary = useMemo(
    () => summarizeDocument(documentText),
    [documentText]
  );
  const hints = useMemo(() => buildHints(summary), [summary]);
  // Hints appear only for builds long enough to leave the user wondering,
  // then rotate so a long rasterization pass keeps saying something new.
  const showHints = elapsed > 3;
  const hintIndex = Math.floor(Math.max(0, elapsed - 3) / 5) % hints.length;

  return (
    <div
      className={cn('p-6 max-w-lg mx-auto space-y-5', className)}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Spinner size="md" />
          <div className="space-y-0.5 min-w-0">
            <p className="text-sm font-medium truncate">
              {summary?.title
                ? `Generating “${summary.title}”`
                : 'Generating document'}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {message || `${stageLabels[currentStage]}...`}
            </p>
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground tabular-nums">
          {elapsed.toFixed(1)}s
        </span>
      </div>

      {summary && summary.counts.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Document contents">
          {summary.counts.map(({ label, count }) => (
            <span
              key={label}
              className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-muted-foreground"
            >
              <span className="font-medium text-foreground tabular-nums">
                {count}
              </span>
              {label}
            </span>
          ))}
        </div>
      )}

      <div className="space-y-3">
        {stages.map((stage, index) => {
          const isActive = index === currentStageIndex;
          const isCompleted = index < currentStageIndex;
          return (
            <div key={stage} className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span
                  className={cn(
                    isActive
                      ? 'text-primary font-medium'
                      : isCompleted
                        ? 'text-muted-foreground'
                        : 'text-muted-foreground/60'
                  )}
                >
                  {stageLabels[stage]}
                </span>
                {isCompleted ? (
                  <CheckIcon />
                ) : isActive ? (
                  <Spinner size="sm" className="h-3.5 w-3.5" />
                ) : (
                  <span className="h-3.5 w-3.5 rounded-full border border-muted-foreground/40" />
                )}
              </div>
              <div className="w-full bg-secondary rounded-full h-1.5 overflow-hidden">
                {isCompleted ? (
                  <div className="h-full w-full rounded-full bg-success" />
                ) : isActive ? (
                  // Honest indeterminate sweep — we have no real progress
                  // signal within a stage, so don't fake a full bar.
                  <div className="h-full w-2/5 rounded-full bg-primary animate-progress-indeterminate" />
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-3 min-h-8">
        <p
          className={cn(
            'text-xs text-muted-foreground/80 italic transition-opacity duration-500',
            showHints ? 'opacity-100' : 'opacity-0'
          )}
        >
          {hints[hintIndex]}
        </p>
        {onCancel && (
          <Button
            variant="outline"
            size="sm"
            onClick={onCancel}
            className="shrink-0"
          >
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}

interface GenerationOverlayProps {
  mode: 'generating' | 'rendering';
  message?: string;
  startedAt?: number;
  onCancel?: () => void;
  className?: string;
}

/**
 * Compact card for the overlay shown on top of an existing preview while a
 * rebuild or re-render is in flight.
 */
export function GenerationOverlay({
  mode,
  message,
  startedAt,
  onCancel,
  className,
}: GenerationOverlayProps) {
  const elapsed = useElapsedSeconds(startedAt);
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-2 rounded-md border bg-background/95 px-6 py-4 shadow-sm',
        className
      )}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2">
        <Spinner size="md" />
        <p className="text-sm font-medium">
          {mode === 'generating' ? 'Generating' : 'Rendering'}
        </p>
        <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground tabular-nums">
          {elapsed.toFixed(1)}s
        </span>
      </div>
      {message && (
        <p className="max-w-xs text-center text-xs text-muted-foreground truncate">
          {message}
        </p>
      )}
      {mode === 'generating' && onCancel && (
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      )}
    </div>
  );
}

interface PreviewLoadingProps {
  renderingLibrary?: string;
  className?: string;
}

export function PreviewLoading({
  renderingLibrary,
  className,
}: PreviewLoadingProps) {
  const getLibraryInfo = (library?: string) => {
    switch (library) {
      case 'LibreOffice':
        return {
          name: 'LibreOffice',
          description: 'Converting document to PDF locally...',
        };
      case 'Office':
        return {
          name: 'Microsoft Office',
          description: 'Uploading file and loading Office viewer...',
        };
      case 'Docs':
        return {
          name: 'Google Docs',
          description: 'Uploading file and loading Docs viewer...',
        };
      default:
        return { name: 'Default', description: 'Processing document...' };
    }
  };

  const { name, description } = getLibraryInfo(renderingLibrary);

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center h-full p-8 space-y-4',
        className
      )}
    >
      <Spinner size="lg" />
      <div className="text-center space-y-2">
        <p className="text-sm font-medium">Rendering Preview</p>
        <p className="text-xs text-muted-foreground">Using {name} renderer</p>
        <p className="text-xs text-muted-foreground/80">{description}</p>
      </div>

      <div className="w-full max-w-md space-y-3">
        <Skeleton className="h-16 w-full" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
        <Skeleton className="h-12 w-full" />
      </div>
    </div>
  );
}

interface InlineLoaderProps {
  message?: string;
  size?: 'sm' | 'md';
  className?: string;
}

export function InlineLoader({
  message = 'Loading...',
  size = 'sm',
  className,
}: InlineLoaderProps) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Spinner size={size} />
      <span className="text-sm text-muted-foreground">{message}</span>
    </div>
  );
}

interface FileOperationLoaderProps {
  operation: 'upload' | 'download' | 'save' | 'delete';
  fileName?: string;
  progress?: number;
  className?: string;
}

export function FileOperationLoader({
  operation,
  fileName,
  progress,
  className,
}: FileOperationLoaderProps) {
  const operationLabels = {
    upload: 'Uploading',
    download: 'Downloading',
    save: 'Saving',
    delete: 'Deleting',
  };

  return (
    <div
      className={cn(
        'flex items-center gap-3 p-3 border rounded-sm bg-header-bg',
        className
      )}
    >
      <Spinner size="sm" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">
          {operationLabels[operation]} {fileName && `"${fileName}"`}
        </p>
        {progress !== undefined && (
          <div className="mt-1">
            <div className="flex justify-between text-xs mb-1">
              <span>{progress}%</span>
              <span className="text-muted-foreground">
                {progress < 100 ? 'In progress...' : 'Complete'}
              </span>
            </div>
            <div className="w-full bg-secondary rounded-full h-1.5">
              <div
                className="bg-primary h-1.5 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
