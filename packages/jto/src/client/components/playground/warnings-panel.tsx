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
        className="flex w-full items-center gap-2 rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/50 px-3 py-1.5 text-left transition-colors hover:bg-amber-100 dark:hover:bg-amber-900/50"
      >
        <ChevronRight
          className={`h-3.5 w-3.5 text-amber-600 dark:text-amber-400 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
        />
        <AlertTriangle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
        <span className="text-xs font-medium text-amber-700 dark:text-amber-300">
          {warnings.length} warning{warnings.length !== 1 ? 's' : ''}
        </span>
      </button>

      {isExpanded && (
        <div className="mt-1.5 space-y-1.5">
          {warnings.map((warning, index) => (
            <div
              key={index}
              className="flex items-start gap-2 rounded-md border border-amber-100 dark:border-amber-900 bg-white dark:bg-amber-950/30 px-3 py-2"
            >
              {warning.severity === 'info' ? (
                <Info className="h-3.5 w-3.5 mt-0.5 text-blue-500 flex-shrink-0" />
              ) : (
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 text-amber-500 flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <code className="text-[11px] font-medium text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/40 px-1 py-0.5 rounded">
                    {warning.component}
                  </code>
                  {warning.severity === 'info' && (
                    <span className="text-[10px] uppercase tracking-wide text-blue-500 font-medium">
                      info
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
                  {warning.message}
                </p>
                {warning.context && Object.keys(warning.context).length > 0 && (
                  <details className="mt-1.5">
                    <summary className="text-[11px] text-gray-400 dark:text-gray-500 cursor-pointer hover:text-gray-600 dark:hover:text-gray-300">
                      Context
                    </summary>
                    <pre className="mt-1 text-[11px] bg-gray-50 dark:bg-gray-900/50 p-1.5 rounded overflow-x-auto text-gray-600 dark:text-gray-400">
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
