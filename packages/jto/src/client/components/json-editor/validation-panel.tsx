import React, { useState, useEffect } from 'react';
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  X,
  AlertTriangle,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import type { JsonEditorError } from '../../lib/json-types';

interface ValidationPanelProps {
  errors: JsonEditorError[];
  onErrorClick?: (error: JsonEditorError) => void;
  onClose?: () => void;
  className?: string;
  isMinimized?: boolean;
  onToggleMinimize?: () => void;
}

export function ValidationPanel({
  errors,
  onErrorClick,
  onClose,
  className,
  isMinimized = false,
  onToggleMinimize,
}: ValidationPanelProps) {
  const [isExpanded, setIsExpanded] = useState(!isMinimized);

  useEffect(() => {
    setIsExpanded(!isMinimized);
  }, [isMinimized]);

  const hasErrors = errors.length > 0;
  const errorCount = errors.length;

  if (!hasErrors) return null;

  const toggleExpanded = () => {
    const newExpanded = !isExpanded;
    setIsExpanded(newExpanded);
    onToggleMinimize?.();
  };

  return (
    <div
      className={cn(
        'absolute bottom-0 left-0 right-0 z-50 bg-background border-t shadow-lg transition-all duration-200',
        isExpanded ? 'h-48' : 'h-10',
        className
      )}
    >
      {/* Header Bar */}
      <div
        className={cn(
          'flex items-center justify-between px-3 py-2 cursor-pointer',
          'bg-destructive/10 border-b border-destructive/20',
          'hover:bg-destructive/15 transition-colors'
        )}
        onClick={toggleExpanded}
      >
        <div className="flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-destructive" />
          <span className="text-sm font-medium text-destructive">
            {errorCount} Validation Error{errorCount !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleExpanded();
            }}
            className="p-1 hover:bg-destructive/20 rounded transition-colors"
            aria-label={isExpanded ? 'Minimize' : 'Expand'}
          >
            {isExpanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronUp className="w-4 h-4" />
            )}
          </button>
          {onClose && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              className="p-1 hover:bg-destructive/20 rounded transition-colors"
              aria-label="Close validation panel"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Error List */}
      {isExpanded && (
        <div className="overflow-y-auto h-[calc(100%-2.5rem)]">
          <div className="divide-y divide-border/50">
            {errors.map((error, index) => (
              <ErrorItem
                key={`${error.path}-${index}`}
                error={error}
                onClick={() => onErrorClick?.(error)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface ErrorItemProps {
  error: JsonEditorError;
  onClick?: () => void;
}

function ErrorItem({ error, onClick }: ErrorItemProps) {
  const getSeverityIcon = (severity: string) => {
    switch (severity) {
    case 'error':
      return (
        <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0" />
      );
    case 'warning':
      return (
        <AlertTriangle className="w-4 h-4 text-yellow-500 flex-shrink-0" />
      );
    default:
      return <AlertCircle className="w-4 h-4 text-blue-500 flex-shrink-0" />;
    }
  };

  const formatPath = (path: string) => {
    if (!path) return 'Document root';
    // Remove leading slash and format nicely
    return path.replace(/^\//, '').replace(/\//g, ' → ');
  };

  return (
    <div
      className={cn(
        'px-3 py-2 hover:bg-muted/50 cursor-pointer transition-colors',
        'group'
      )}
      onClick={onClick}
    >
      <div className="flex items-start gap-2">
        {getSeverityIcon(error.severity)}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-mono text-muted-foreground">
              {error.startLineNumber && error.startColumn
                ? `Line ${error.startLineNumber}:${error.startColumn}`
                : 'Unknown location'}
            </span>
            {error.path && (
              <>
                <span className="text-xs text-muted-foreground">•</span>
                <span className="text-xs text-muted-foreground truncate">
                  {formatPath(error.path)}
                </span>
              </>
            )}
          </div>
          <p className="text-sm text-foreground">{error.message}</p>
          {error.code && error.code !== 'validation_error' && (
            <span className="text-xs text-muted-foreground font-mono mt-1 inline-block">
              Code: {error.code}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// Status bar component for minimal error display
export function ValidationStatusBar({
  errors,
  onClick,
  className,
}: {
  errors: JsonEditorError[];
  onClick?: () => void;
  className?: string;
}) {
  if (errors.length !== 0) {
    return (
      <div
        className={cn(
          'flex items-center gap-2 px-2 py-1 text-xs cursor-pointer',
          'bg-destructive/10 text-destructive hover:bg-destructive/15 transition-colors',
          className
        )}
        onClick={onClick}
      >
        <AlertCircle className="w-3 h-3" />
        <span>
          {errors.length} error{errors.length !== 1 ? 's' : ''}
        </span>
      </div>
    );
  }
}
