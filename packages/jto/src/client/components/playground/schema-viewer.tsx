import React, { useState, memo } from 'react';
import { ChevronDown, ChevronRight, Copy, Check, FileJson } from 'lucide-react';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';
import { Alert, AlertDescription } from '../ui/alert';
import { Badge } from '../ui/badge';
import { Skeleton } from '../ui/skeleton';
import { copySchemaToClipboard } from '../../lib/clipboard';
import { cn } from '../../lib/utils';

interface SchemaViewerProps {
  schema: any;
  loading?: boolean;
  error?: string;
  className?: string;
  onCopy?: () => void;
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
    const [isExpanded, setIsExpanded] = useState(depth < 2); // Auto-expand first 2 levels
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
        // Special handling for certain string patterns
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
 * Schema viewer component with syntax highlighting and copy functionality
 */
export const SchemaViewer = memo(
  ({
    schema,
    loading = false,
    error,
    className,
    onCopy,
  }: SchemaViewerProps) => {
    const [copied, setCopied] = useState(false);
    const [copyError, setCopyError] = useState<string | null>(null);

    const handleCopy = async () => {
      setCopyError(null);
      try {
        const success = await copySchemaToClipboard(schema);
        if (success) {
          setCopied(true);
          onCopy?.();
          setTimeout(() => setCopied(false), 2000);
        } else {
          setCopyError('Failed to copy schema to clipboard');
        }
      } catch (error) {
        console.error('Copy failed:', error);
        setCopyError('An error occurred while copying');
      }
    };

    // Extract metadata from schema
    const metadata = schema
      ? {
          title: schema.title,
          description: schema.description,
          version: schema.$id || schema.version,
          schemaVersion: schema.$schema,
        }
      : null;

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
      <div className={cn('space-y-4', className)}>
        {/* Metadata Section */}
        {metadata && (metadata.title || metadata.description) && (
          <div className="space-y-2">
            {metadata.title && (
              <div className="flex items-center gap-2">
                <FileJson className="h-5 w-5 text-muted-foreground" />
                <h3 className="text-lg font-semibold">{metadata.title}</h3>
                {metadata.version && (
                  <Badge variant="outline" className="text-xs">
                    {metadata.version}
                  </Badge>
                )}
              </div>
            )}
            {metadata.description && (
              <p className="text-sm text-muted-foreground">
                {metadata.description}
              </p>
            )}
            {metadata.schemaVersion && (
              <p className="text-xs text-muted-foreground">
                Schema: {metadata.schemaVersion}
              </p>
            )}
          </div>
        )}

        {/* Copy Button */}
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopy}
            disabled={copied}
          >
            {copied ? (
              <>
                <Check className="h-4 w-4 mr-2" />
                Copied!
              </>
            ) : (
              <>
                <Copy className="h-4 w-4 mr-2" />
                Copy Schema
              </>
            )}
          </Button>
        </div>

        {/* Copy Error Alert */}
        {copyError && (
          <Alert variant="destructive">
            <AlertDescription>{copyError}</AlertDescription>
          </Alert>
        )}

        {/* Schema Tree View */}
        <ScrollArea className="h-[500px] w-full rounded-md border bg-muted/10 p-4">
          <div className="font-mono text-xs">
            <JsonNode value={schema} />
          </div>
        </ScrollArea>

        {/* Info Footer */}
        <div className="text-xs text-muted-foreground space-y-1">
          <p>• Click on arrows to expand/collapse sections</p>
          <p>
            • This is a read-only view of the JSON schema used for validation
          </p>
          <p>• Use the Copy button to copy the full schema to your clipboard</p>
        </div>
      </div>
    );
  }
);

SchemaViewer.displayName = 'SchemaViewer';
