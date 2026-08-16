import React from 'react';
import { AlertTriangle, Info, ChevronRight } from 'lucide-react';
import type { GenerationWarning } from '../../store/output-store';

interface WarningsPanelProps {
  warnings: GenerationWarning[] | null | undefined;
  className?: string;
}

export function WarningsPanel({ warnings, className }: WarningsPanelProps) {
  const [isExpanded, setIsExpanded] = React.useState(false);

  if (!warnings || warnings.length === 0) {
    return null;
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center gap-2 rounded-sm border border-transparent bg-warning/10 px-3 py-1.5 text-left transition-colors hover:bg-warning/20"
      >
        <ChevronRight
          className={`h-3.5 w-3.5 text-warning transition-transform flex-shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
        />
        <AlertTriangle className="h-3.5 w-3.5 text-warning flex-shrink-0" />
        <span className="text-xs font-medium text-warning">
          {warnings.length} warning{warnings.length !== 1 ? 's' : ''}
        </span>
      </button>

      {isExpanded && (
        <div className="mt-1.5 space-y-1.5">
          {warnings.map((warning, index) => (
            <div
              key={index}
              className="flex items-start gap-2 rounded-sm border bg-card px-3 py-2"
            >
              {warning.severity === 'info' ? (
                <Info className="h-3.5 w-3.5 mt-0.5 text-data-blue flex-shrink-0" />
              ) : (
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 text-warning flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <code className="text-[11px] font-medium text-warning bg-warning/15 px-1 py-0.5 rounded-sm">
                    {warning.component}
                  </code>
                  {warning.severity === 'info' && (
                    <span className="text-[10px] uppercase tracking-wide text-data-blue font-medium">
                      info
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                  {warning.message}
                </p>
                {warning.context && Object.keys(warning.context).length > 0 && (
                  <details className="mt-1.5">
                    <summary className="text-[11px] text-muted-foreground/70 cursor-pointer hover:text-foreground">
                      Context
                    </summary>
                    <pre className="mt-1 text-[11px] bg-header-bg p-1.5 rounded-sm overflow-x-auto text-muted-foreground">
                      {JSON.stringify(warning.context, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
