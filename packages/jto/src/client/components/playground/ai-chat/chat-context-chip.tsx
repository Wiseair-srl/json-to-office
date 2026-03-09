import { FileCode2, X } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../ui/tooltip';
import type { SelectionContext } from '../../../lib/monaco-selection-utils';

interface ChatContextChipProps {
  context: SelectionContext & { documentName?: string };
  onRemove: () => void;
}

/** Turn `children[0].children[0]` into a short human label like "paragraph" */
function humanizeContext(ctx: SelectionContext & { documentName?: string }) {
  // Try to extract the component "name" from the selected JSON
  try {
    const parsed = JSON.parse(ctx.selectedText);
    if (parsed?.name) return parsed.name;
  } catch {
    // not valid JSON, fall through
  }

  // Try property key
  if (ctx.propertyKey) return ctx.propertyKey;

  // Last segment of jsonPath, cleaned up
  if (ctx.jsonPath) {
    const last = ctx.jsonPath.split('.').pop() ?? ctx.jsonPath;
    return last.replace(/\[\d+\]/g, '');
  }

  return 'selection';
}

/** One-line text preview */
function previewText(text: string, max = 50) {
  const oneLine = text.replace(/[\n\r]+/g, ' ').replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? oneLine.slice(0, max) + '…' : oneLine;
}

export function ChatContextChip({ context, onRemove }: ChatContextChipProps) {
  const componentName = humanizeContext(context);
  const docName = context.documentName?.replace(/\.json$/, '') ?? '';
  const label = docName ? `${docName} › ${componentName}` : componentName;
  const preview = previewText(context.selectedText);

  const chip = (
    <div className="group flex items-center gap-1.5 rounded-md border border-primary/20 bg-primary/5 pl-2 pr-1 py-1 text-xs max-w-[280px] transition-colors hover:bg-primary/10">
      <FileCode2 className="h-3 w-3 shrink-0 text-primary/60" />
      <span className="truncate font-medium">{label}</span>
      <button
        type="button"
        onClick={onRemove}
        className="shrink-0 rounded-sm p-0.5 opacity-60 hover:opacity-100 hover:bg-muted transition-opacity"
        aria-label="Remove context"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>{chip}</TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        <p className="text-xs font-medium mb-0.5">{label}</p>
        <p className="text-xs text-muted-foreground font-mono">{preview}</p>
        {context.jsonPath && (
          <p className="text-[10px] text-muted-foreground/60 mt-1">{context.jsonPath}</p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
