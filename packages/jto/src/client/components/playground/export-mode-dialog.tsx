import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';

/**
 * Two modes after embed removal:
 *   - `custom`    — ship font references as-is; recipient-side fonts.
 *                   Matches the preview (LibreOffice font staging).
 *   - `substitute` — rewrite non-safe families to SAFE_FONTS equivalents.
 */
export type ExportFontMode = 'custom' | 'substitute';

export function ExportModeDialog({
  open,
  onClose,
  nonSafeFonts,
  onChoose,
}: {
  open: boolean;
  onClose: () => void;
  nonSafeFonts: string[];
  onChoose: (mode: ExportFontMode) => void;
}) {
  const [mode, setMode] = React.useState<ExportFontMode>('custom');

  // Dialog content stays mounted across close/reopen (Radix). Reset to
  // the safe default every time the dialog opens so the user doesn't
  // carry a previous `substitute` selection into a fresh export flow.
  React.useEffect(() => {
    if (open) setMode('custom');
  }, [open]);

  const list =
    nonSafeFonts.length === 1
      ? nonSafeFonts[0]
      : nonSafeFonts.slice(0, 3).join(', ') +
        (nonSafeFonts.length > 3 ? ` +${nonSafeFonts.length - 3} more` : '');

  const options: {
    value: ExportFontMode;
    title: string;
    desc: string;
  }[] = [
    {
      value: 'custom',
      title: 'Keep custom fonts',
      desc: 'Recipients with the font installed see the authored typeface. Others get a generic fallback.',
    },
    {
      value: 'substitute',
      title: 'Convert to safe fonts',
      desc: 'Rewrite non-safe families to Calibri / Georgia / Consolas so every recipient sees the same glyphs.',
    },
  ];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Non-safe fonts in this document</DialogTitle>
          <DialogDescription>
            {list} {nonSafeFonts.length === 1 ? 'is' : 'are'} not in the
            built-in safe list. Choose how to export.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 py-2">
          {options.map((o) => {
            const selected = mode === o.value;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => setMode(o.value)}
                className={`text-left rounded-md border px-3 py-2 transition-colors ${
                  selected
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:bg-muted/40'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`h-3.5 w-3.5 rounded-full border flex items-center justify-center ${
                      selected ? 'border-primary' : 'border-muted-foreground/50'
                    }`}
                  >
                    {selected && (
                      <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                    )}
                  </span>
                  <span className="text-sm font-medium">{o.title}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground pl-6">
                  {o.desc}
                </p>
              </button>
            );
          })}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => {
              onChoose(mode);
              onClose();
            }}
          >
            Download
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
