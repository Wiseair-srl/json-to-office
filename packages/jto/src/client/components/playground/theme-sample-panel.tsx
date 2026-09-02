import React, { useCallback, useContext, useMemo } from 'react';
import { Play } from 'lucide-react';
import { Button } from '../ui/button';
import { useToast } from '../ui/use-toast';
import { ThemeSpecimenMemoized } from '../theme-editor/theme-specimen';
import { useDocumentsStore } from '../../store/documents-store-provider';
import {
  ThemesStoreContext,
  useThemesStore,
} from '../../store/themes-store-provider';
import { currentDocumentText } from '../../lib/active-document-text';
import { parseTheme } from '../../lib/theme-editor/model';
import { getThemeName } from '../../lib/theme-validation';
import { FORMAT } from '../../lib/env';

/**
 * The theme sample, over the preview.
 *
 * It floats rather than sitting at the top of the form for the same reason
 * the quality drawers do: it changes on every keystroke, and a card that
 * redraws in flow shoves the field being typed in down the screen. Here it
 * sits beside the real render instead — the approximation and the thing it
 * approximates, one Escape apart.
 */
export function ThemeSamplePanel({
  themeDocName,
  onRan,
}: {
  themeDocName: string;
  /** Called once a real render is on its way, so the drawer can get out of it. */
  onRan: () => void;
}) {
  const text = useDocumentsStore(
    (s) => s.documents.find((d) => d.name === themeDocName)?.text ?? ''
  );
  const updateTheme = useThemesStore((s) => s.updateTheme);
  const themesStore = useContext(ThemesStoreContext);
  const { toast } = useToast();

  const parsed = useMemo(() => parseTheme(text), [text]);
  const themeName = parsed.ok ? getThemeName(parsed.theme) : null;

  const runSample = useCallback(() => {
    // The JSON view saves on a debounce; the live editor text is the truth.
    const live = currentDocumentText(themeDocName, text);
    let name: string | null = null;
    try {
      name = getThemeName(JSON.parse(live));
    } catch {}
    if (!name) {
      toast({
        title: 'Theme has no name',
        description: 'Give the theme a "name" so a document can refer to it.',
        variant: 'destructive',
      });
      return;
    }
    // The build reads the themes store, so it must hold this text before the
    // event fires, ahead of the debounced update the tab would send. Only
    // when it differs: an unchanged theme written again still gets a new
    // record, and the preview treats that as an edit that outdates it.
    const existing = themesStore?.getState().customThemes[themeDocName];
    if (!existing || existing.content !== live) {
      updateTheme(themeDocName, live);
    }
    window.dispatchEvent(
      new CustomEvent('preview:buildSpecimen', { detail: { themeDocName } })
    );
    onRan();
  }, [onRan, text, themeDocName, themesStore, toast, updateTheme]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <h3 className="text-sm font-medium">Theme sample</h3>
          <p className="text-[11px] leading-snug text-muted-foreground">
            Approximate — drawn by the browser, not the renderer.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-7 shrink-0 gap-1.5 px-2.5 text-xs"
          onClick={runSample}
          disabled={!themeName}
          title={
            themeName
              ? `Render a sample ${FORMAT === 'docx' ? 'document' : 'deck'} in "${themeName}" through the same pipeline as Run`
              : 'Give the theme a name first'
          }
        >
          <Play className="size-3.5" />
          Run sample
        </Button>
      </div>
      {parsed.ok ? (
        <ThemeSpecimenMemoized theme={parsed.theme} />
      ) : (
        <p className="text-xs text-muted-foreground">
          The theme JSON has an error:{' '}
          <span className="text-destructive">{parsed.error}</span>
        </p>
      )}
    </div>
  );
}

export const ThemeSamplePanelMemoized = React.memo(ThemeSamplePanel);
