import React, { useState, memo } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';
import { Alert, AlertDescription } from '../ui/alert';
import { Skeleton } from '../ui/skeleton';
import { cn } from '../../lib/utils';

interface SchemaViewerProps {
  schema: any;
  loading?: boolean;
  error?: string;
  className?: string;
}

/**
 * Collapsible JSON tree node component
 */
const JsonNode = memo(
  ({
    keyName,
    value,
    depth = 0,
    isLast = false,
  }: {
    keyName?: string;
    value: any;
    depth?: number;
    isLast?: boolean;
  }) => {
    const [isExpanded, setIsExpanded] = useState(depth < 2);
    const isObject = value !== null && typeof value === 'object';
    const isArray = Array.isArray(value);

    const toggleExpand = () => setIsExpanded(!isExpanded);

    const renderValue = () => {
      if (value === null) return <span className="text-orange-500">null</span>;
      if (value === undefined)
        return <span className="text-gray-500">undefined</span>;
      if (typeof value === 'boolean')
        return <span className="text-blue-500">{String(value)}</span>;
      if (typeof value === 'number')
        return <span className="text-green-500">{value}</span>;
      if (typeof value === 'string') {
        if (value.startsWith('http')) {
          return <span className="text-purple-500">"{value}"</span>;
        }
        if (value.startsWith('#/')) {
          return <span className="text-cyan-500">"{value}"</span>;
        }
        return <span className="text-amber-600">"{value}"</span>;
      }
      return null;
    };

    const childCount = isObject ? Object.keys(value).length : 0;

    return (
      <div className={cn('text-sm', depth > 0 && 'ml-4')}>
        <div className="flex items-start hover:bg-muted/30 rounded px-1 py-0.5">
          {isObject && (
            <button
              onClick={toggleExpand}
              className="mr-1 hover:bg-muted rounded p-0.5"
              aria-label={isExpanded ? 'Collapse' : 'Expand'}
            >
              {isExpanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
            </button>
          )}

          {!isObject && <span className="w-4" />}

          {keyName && (
            <>
              <span className="text-blue-600 dark:text-blue-400">
                "{keyName}"
              </span>
              <span className="mx-1">:</span>
            </>
          )}

          {isObject ? (
            <span className="text-muted-foreground">
              {isArray ? '[' : '{'}
              {!isExpanded && (
                <span className="mx-1 text-xs">
                  {childCount} {isArray ? 'items' : 'properties'}
                </span>
              )}
              {!isExpanded && (isArray ? ']' : '}')}
            </span>
          ) : (
            renderValue()
          )}

          {!isObject && !isLast && (
            <span className="text-muted-foreground">,</span>
          )}
        </div>

        {isObject && isExpanded && (
          <div className="ml-4">
            {isArray
              ? value.map((item: any, index: number) => (
                <JsonNode
                  key={index}
                  keyName={String(index)}
                  value={item}
                  depth={depth + 1}
                  isLast={index === value.length - 1}
                />
              ))
              : Object.entries(value).map(([key, val], index, arr) => (
                <JsonNode
                  key={key}
                  keyName={key}
                  value={val}
                  depth={depth + 1}
                  isLast={index === arr.length - 1}
                />
              ))}
            <div className="ml-4">
              <span className="text-muted-foreground">
                {isArray ? ']' : '}'}
                {!isLast && ','}
              </span>
            </div>
          </div>
        )}
      </div>
    );
  }
);

JsonNode.displayName = 'JsonNode';

/**
 * Schema viewer component with collapsible JSON tree
 */
export const SchemaViewer = memo(
  ({ schema, loading = false, error, className }: SchemaViewerProps) => {
    if (loading) {
      return (
        <div className={cn('space-y-4', className)}>
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      );
    }

    if (error) {
      return (
        <Alert variant="destructive" className={className}>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      );
    }

    if (!schema) {
      return (
        <Alert className={className}>
          <AlertDescription>No schema available</AlertDescription>
        </Alert>
      );
    }

    return (
      <ScrollArea className={cn('h-full w-full rounded-md border bg-muted/10 p-4', className)}>
        <div className="font-mono text-xs">
          <JsonNode value={schema} />
        </div>
      </ScrollArea>
    );
  }
);

SchemaViewer.displayName = 'SchemaViewer';
