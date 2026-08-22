import React, { useState, useCallback, useContext } from 'react';
import { ThemesStoreContext } from '../../store/themes-store-provider';
import {
  SaveIcon,
  InfoIcon,
  PlayIcon,
  BarChart3Icon,
  FileJson,
  Trash2Icon,
  Code2,
  AlertTriangle,
  MessageSquare,
  Eye,
  EyeOff,
  MoreHorizontal,
  Type as TypeIcon,
} from 'lucide-react';
import { Spinner } from '../ui/spinner';
import { Button } from '../ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { Textarea } from '../ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { download } from '../../lib/download';
import { KbdShortcut } from '../ui/kbd';
import { apiClient } from '../../api/client';
import { useToast } from '../ui/use-toast';
import { usePresentationGenerator } from '../../hooks/usePresentationGenerator';
import { useRendererIds } from '../../hooks/useRendererIds';
import { useSettingsStore } from '../../store/settings-store-provider';
import { buildWarningsDocumentJson } from '../../lib/warnings-document-builder';
import type { GenerationWarning } from '../../store/output-store';
import { FORMAT, FORMAT_EXT } from '../../lib/env';
import {
  collectFontNamesFromDocx,
  collectFontNamesFromPptx,
  isSafeFont,
} from '@json-to-office/shared';
import { ExportModeDialog, type ExportFontMode } from './export-mode-dialog';

function PreviewHeader({
  name,
  blob,
  onManualRender,
  isGenerating,
  isRendering,
  onShowCacheMetrics,
  onShowSchemas,
  onShowFonts,
  documentText,
  editorDocumentText,
  warnings,
  onToggleChat,
  chatOpen,
  onTogglePreview,
  previewOpen,
}: {
  name: string;
  blob?: Blob;
  onManualRender: () => void;
  isGenerating?: boolean;
  isRendering?: boolean;
  onShowCacheMetrics?: () => void;
  onShowSchemas?: () => void;
  onShowFonts?: () => void;
  documentText?: string;
  /**
   * The active editor document's text. Drives "Copy standard components":
   * unlike `documentText` (the last generated output's source), it exists
   * before the first Run (#155).
   */
  editorDocumentText?: string;
  warnings?: GenerationWarning[] | null;
  onToggleChat?: () => void;
  chatOpen?: boolean;
  onTogglePreview?: () => void;
  previewOpen?: boolean;
}) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [isDownloadingWarnings, setIsDownloadingWarnings] = useState(false);
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [isCopyingStandardComponents, setIsCopyingStandardComponents] =
    useState(false);
  // Non-null when the async clipboard write was denied: the dialog re-offers
  // the fetched JSON behind a button whose click is a fresh user gesture.
  const [standardComponentsFallbackJson, setStandardComponentsFallbackJson] =
    useState<string | null>(null);
  const { toast } = useToast();
  // The hook is format-agnostic (dispatches on FORMAT env); alias to a
  // neutral name so DOCX call sites don't read as if they're calling a
  // PPTX-specific generator.
  const { generateDocument } = usePresentationGenerator();
  const themesStore = useContext(ThemesStoreContext)!;
  // Read from the store rather than taken as a prop: the generator hook reads
  // the same value, so a control that only informed this component would drift
  // from what actually rendered.
  const backends = useRendererIds();
  const generationBackend = useSettingsStore((s) => s.generationBackend);
  const setSettings = useSettingsStore((s) => s.setSettings);
  const activeBackend = generationBackend ?? backends.default ?? undefined;

  /**
   * Snapshot the current valid custom themes into the `{ [name]: parsed }`
   * shape the server expects. Matches the helper in editor.tsx — without
   * this, a Substitute-mode Download goes through with an empty themes
   * map and the server falls back to the built-in "minimal" theme.
   */
  const getFreshThemeData = useCallback((): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    const { customThemes } = themesStore.getState();
    Object.values(customThemes).forEach((theme: any) => {
      if (theme.valid && theme.parsed) {
        out[theme.name] = theme.parsed;
      }
    });
    return out;
  }, [themesStore]);

  // Non-safe font references detected in the current document text.
  // The Export-mode dialog only opens when at least one is present;
  // safe-only docs download the already-rendered blob directly.
  const nonSafeFonts = React.useMemo(() => {
    if (!documentText) return [] as string[];
    try {
      const parsed = JSON.parse(documentText);
      const collector =
        FORMAT === 'pptx' ? collectFontNamesFromPptx : collectFontNamesFromDocx;
      return [...collector(parsed)].filter((f) => !isSafeFont(f));
    } catch {
      return [];
    }
  }, [documentText]);

  const [exportDialogOpen, setExportDialogOpen] = useState(false);

  const downloadCurrentBlob = useCallback(async () => {
    if (!blob) return;
    setIsDownloading(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      download(`${name}${FORMAT_EXT}`, blob);
    } finally {
      setTimeout(() => setIsDownloading(false), 500);
    }
  }, [blob, name]);

  const handleDownload = useCallback(async () => {
    if (!blob) return;
    if (nonSafeFonts.length === 0) {
      await downloadCurrentBlob();
      return;
    }
    setExportDialogOpen(true);
  }, [blob, nonSafeFonts.length, downloadCurrentBlob]);

  const handleDownloadWithMode = useCallback(
    async (mode: ExportFontMode) => {
      if (!documentText) return;
      // Force an explicit fonts.mode on download — don't rely on the
      // cached preview blob matching the user's choice, since the server
      // default could drift and the preview's generation didn't pin a mode.
      setIsDownloading(true);
      try {
        const result = await generateDocument(
          name,
          documentText,
          getFreshThemeData(),
          undefined,
          { bypassCache: true, fonts: { mode } }
        );
        // The hook always resolves with a populated `blob`; guard against a
        // zero-byte payload (e.g. server returned success with an empty
        // buffer) rather than an "is blob present" check that can't fail.
        if (result.blob.size === 0) {
          toast({
            title: 'Export failed',
            description: 'The server returned an empty document.',
            variant: 'destructive',
          });
        } else {
          download(`${name}${FORMAT_EXT}`, result.blob);
          // Surface substitute swaps / custom-mode advisory so the user
          // knows what happened to their non-safe fonts in the downloaded
          // file. The in-page warnings panel reflects the last preview
          // build, not this download.
          const fontModeWarning = result.warnings?.find(
            (w) =>
              w.context?.code === 'FONT_MODE_SUBSTITUTED' ||
              w.context?.code === 'FONT_MODE_CUSTOM'
          );
          if (fontModeWarning) {
            toast({
              title:
                mode === 'substitute'
                  ? 'Fonts substituted'
                  : 'Non-safe fonts kept',
              description: fontModeWarning.message,
            });
          }
        }
      } catch (err) {
        toast({
          title: 'Export failed',
          description: err instanceof Error ? err.message : String(err),
          variant: 'destructive',
        });
      } finally {
        setTimeout(() => setIsDownloading(false), 500);
      }
    },
    [documentText, name, generateDocument, toast, getFreshThemeData]
  );

  const handleDownloadWarnings = useCallback(async () => {
    if (!warnings || warnings.length === 0) return;

    setIsDownloadingWarnings(true);
    try {
      // Build warnings document JSON
      const warningsDocJson = buildWarningsDocumentJson(warnings);
      if (!warningsDocJson) {
        toast({
          title: 'No warnings',
          description: 'There are no warnings to download.',
          variant: 'destructive',
        });
        return;
      }

      // Generate document from warnings document JSON
      // Pass empty customThemes to ensure we use built-in themes only
      const result = await generateDocument(
        'warnings',
        JSON.stringify(warningsDocJson, null, 2),
        {} // Empty customThemes to avoid conflicts with user's custom themes
      );

      if (
        result &&
        typeof result === 'object' &&
        'blob' in result &&
        result.blob
      ) {
        // Download the generated warnings document
        download(`${name}-warnings${FORMAT_EXT}`, result.blob as Blob);
        toast({
          title: 'Warnings downloaded',
          description: `Downloaded warnings document with ${warnings.length} warning(s).`,
        });
      }
    } catch (error) {
      console.error('Failed to generate warnings document:', error);
      toast({
        title: 'Download failed',
        description:
          error instanceof Error
            ? error.message
            : 'Failed to generate warnings document',
        variant: 'destructive',
      });
    } finally {
      setTimeout(() => setIsDownloadingWarnings(false), 500);
    }
  }, [warnings, name, generateDocument, toast]);

  const handleClearCache = useCallback(async () => {
    setIsClearingCache(true);
    try {
      await apiClient.delete(`/${FORMAT}/cache`);
      // Trigger a custom event to refresh cache metrics if they're open
      window.dispatchEvent(new CustomEvent('cache:cleared'));

      // Show success toast
      toast({
        title: 'Cache Cleared',
        description:
          'All caches (document and component) have been successfully cleared.',
        variant: 'default',
      });
    } catch (error) {
      console.error('Failed to clear cache:', error);

      // Show error toast
      toast({
        title: 'Cache Clear Failed',
        description: 'Failed to clear caches. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsClearingCache(false);
    }
  }, [toast]);

  // The text "Copy standard components" operates on: the active editor
  // document when available (works before the first Run), else the last
  // generated output's source (#155).
  const copySourceText = editorDocumentText ?? documentText;

  const handleCopyStandardComponents = useCallback(() => {
    // NOT async: navigator.clipboard.write must be invoked while the click's
    // user activation is still live. The server round trip rides inside the
    // ClipboardItem as a promise payload; awaiting it before writing is what
    // used to kill the write with NotAllowedError (#155).
    if (!copySourceText) {
      toast({
        title: 'No document available',
        description: 'Please select a document to copy standard components',
        variant: 'destructive',
      });
      return;
    }
    try {
      JSON.parse(copySourceText);
    } catch {
      toast({
        title: 'Document is not valid JSON',
        description: 'Fix the JSON errors in the editor, then copy again',
        variant: 'destructive',
      });
      return;
    }

    setIsCopyingStandardComponents(true);

    const jsonPromise = (async () => {
      const response = await fetch(`/api/${FORMAT}/standard-components`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonDefinition: copySourceText,
          customThemes: getFreshThemeData(),
          // sourceName lets the server inline a discovered document's bundled
          // media before safe-mode source validation — without it, templates
          // referencing relative media paths 400 here while rendering fine.
          options: { sourceName: name },
        }),
      });

      if (!response.ok) {
        let description = `Request failed with status ${response.status}`;
        try {
          const errorData = await response.json();
          // The server error handler serializes HTTPExceptions as `error`.
          const message = errorData.error ?? errorData.message;
          if (typeof message === 'string' && message) description = message;
        } catch {}
        throw new Error(description);
      }

      const result = await response.json();
      return JSON.stringify(result.data, null, 2);
    })();

    // Start the clipboard write synchronously (gesture still live), then
    // settle the UI asynchronously.
    let writePromise: Promise<void>;
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      writePromise = navigator.clipboard.write([
        new ClipboardItem({
          // Promise-of-Blob payload: accepted by Chromium and Safari even
          // when it resolves after the activation window has passed.
          'text/plain': jsonPromise.then(
            (text) => new Blob([text], { type: 'text/plain' })
          ),
        }),
      ]);
    } else if (navigator.clipboard?.writeText) {
      writePromise = jsonPromise.then((text) =>
        navigator.clipboard.writeText(text)
      );
    } else {
      writePromise = Promise.reject(
        new Error('Clipboard is not available in this context')
      );
    }

    void (async () => {
      try {
        await writePromise;
        toast({
          title: 'Copied to clipboard',
          description: 'Standard components JSON has been copied',
        });
      } catch (error) {
        // Disambiguate: a rejected fetch means there is nothing to copy —
        // report it. A denied/unavailable clipboard write with a good payload
        // falls back to a dialog whose Copy button gets a fresh gesture.
        let json: string | null = null;
        try {
          json = await jsonPromise;
        } catch (fetchError) {
          console.error('Error fetching standard components:', fetchError);
          toast({
            title: 'Failed to get standard components',
            description:
              fetchError instanceof Error
                ? fetchError.message
                : 'Request failed',
            variant: 'destructive',
          });
          return;
        }
        console.error('Clipboard write failed:', error);
        setStandardComponentsFallbackJson(json);
      } finally {
        setIsCopyingStandardComponents(false);
      }
    })();
  }, [copySourceText, name, getFreshThemeData, toast]);

  const handleCopyFromFallbackDialog = useCallback(async () => {
    if (standardComponentsFallbackJson == null) return;
    try {
      await navigator.clipboard.writeText(standardComponentsFallbackJson);
      toast({
        title: 'Copied to clipboard',
        description: 'Standard components JSON has been copied',
      });
      setStandardComponentsFallbackJson(null);
    } catch {
      toast({
        title: 'Clipboard unavailable',
        description: 'Select the JSON in the dialog and copy it manually',
        variant: 'destructive',
      });
    }
  }, [standardComponentsFallbackJson, toast]);

  return (
    <>
      {/* App header: a hairline is what separates it from the panes below —
          the system uses borders, not elevation, to divide planes. */}
      <div className="bg-sidebar border-b flex flex-row flex-nowrap items-center justify-between gap-x-2 px-3 py-1.5">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <p className="text-foreground text-sm font-semibold tracking-tight truncate flex-1 min-w-0">
            {name}
          </p>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Preview disclaimer"
                className="cursor-help inline-flex items-center justify-center h-6 w-6 rounded-sm hover:bg-muted/60 shrink-0"
              >
                <InfoIcon className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-sm">
              <p className="text-sm">
                Preview converts the file to a PDF with LibreOffice. Download
                the {FORMAT_EXT} to verify fidelity.
              </p>
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="flex flex-row items-center gap-x-1 shrink-0">
          {/* ── Render group ── */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="default"
                size="sm"
                className="gap-1.5 h-7 px-2.5"
                onClick={onManualRender}
                aria-label="Render preview"
                disabled={isGenerating || isRendering || previewOpen === false}
              >
                {isRendering ? (
                  <Spinner size="sm" />
                ) : (
                  <PlayIcon className="h-3.5 w-3.5" />
                )}
                <span className="text-xs font-medium hidden sm:inline">
                  Run
                </span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>
                {previewOpen === false
                  ? 'Open preview to run'
                  : isRendering
                    ? 'Rendering preview...'
                    : 'Render preview'}
              </p>
            </TooltipContent>
          </Tooltip>

          {/* ── Divider ── */}
          <div className="w-px h-4 bg-border/60 mx-1" />

          {/* ── Output group ── */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 h-7 px-2.5"
                disabled={!blob || isDownloading || isGenerating}
                onClick={handleDownload}
              >
                {isDownloading ? (
                  <Spinner size="sm" />
                ) : (
                  <SaveIcon className="h-3.5 w-3.5" />
                )}
                <span className="text-xs font-medium hidden sm:inline">
                  Download
                </span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Download {FORMAT_EXT}</p>
            </TooltipContent>
          </Tooltip>

          {/* Download Warnings Button - Only show when warnings exist */}
          {warnings && warnings.length > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7 border-transparent bg-warning/10 text-warning hover:bg-warning/20"
                  disabled={isDownloadingWarnings || isGenerating}
                  onClick={handleDownloadWarnings}
                >
                  {isDownloadingWarnings ? (
                    <Spinner size="sm" />
                  ) : (
                    <AlertTriangle className="h-3.5 w-3.5" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Download warnings ({warnings.length})</p>
              </TooltipContent>
            </Tooltip>
          )}

          {backends.ids.length > 1 && (
            <Select
              value={activeBackend}
              onValueChange={(id) => setSettings({ generationBackend: id })}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <SelectTrigger className="w-[150px] h-7 text-xs hidden lg:flex">
                    <SelectValue placeholder="Backend" />
                  </SelectTrigger>
                </TooltipTrigger>
                <TooltipContent>
                  <p>
                    Backend that writes the {FORMAT.toUpperCase()} file. A
                    non-default one may refuse a document it cannot express.
                  </p>
                </TooltipContent>
              </Tooltip>
              <SelectContent className="text-sidebar-foreground">
                {backends.ids.map((id) => (
                  <SelectItem value={id} key={id}>
                    {id}
                    {id === backends.default ? '' : ' (experimental)'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* ── Divider ── */}
          <div className="w-px h-4 bg-border/60 mx-1" />

          {/* ── Secondary actions overflow menu ── */}
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7">
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>
                <p>More actions</p>
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-52">
              {onShowSchemas && (
                <DropdownMenuItem onClick={onShowSchemas}>
                  <FileJson className="h-4 w-4 mr-2" />
                  View JSON Schemas
                </DropdownMenuItem>
              )}
              {onShowFonts && (
                <DropdownMenuItem onClick={onShowFonts}>
                  <TypeIcon className="h-4 w-4 mr-2" />
                  Browse fonts
                </DropdownMenuItem>
              )}
              {onShowCacheMetrics && (
                <DropdownMenuItem onClick={onShowCacheMetrics}>
                  <BarChart3Icon className="h-4 w-4 mr-2" />
                  View cache metrics
                </DropdownMenuItem>
              )}
              {copySourceText ? (
                <DropdownMenuItem
                  onClick={handleCopyStandardComponents}
                  disabled={isCopyingStandardComponents}
                >
                  <Code2 className="h-4 w-4 mr-2" />
                  {isCopyingStandardComponents
                    ? 'Copying...'
                    : 'Copy standard components'}
                </DropdownMenuItem>
              ) : (
                <Tooltip>
                  {/* Disabled items swallow pointer events; the wrapper span
                      keeps hover alive so the disabled state explains itself. */}
                  <TooltipTrigger asChild>
                    <span className="block">
                      <DropdownMenuItem disabled>
                        <Code2 className="h-4 w-4 mr-2" />
                        Copy standard components
                      </DropdownMenuItem>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="left">
                    <p>
                      No document selected — open or select a document first
                    </p>
                  </TooltipContent>
                </Tooltip>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setShowClearConfirm(true)}
                disabled={isClearingCache}
                className="text-destructive focus:text-destructive"
              >
                <Trash2Icon className="h-4 w-4 mr-2" />
                {isClearingCache ? 'Clearing...' : 'Clear all caches'}
              </DropdownMenuItem>
              {/* Generation backend for small screens */}
              {backends.ids.length > 1 && (
                <>
                  <DropdownMenuSeparator className="lg:hidden" />
                  {backends.ids.map((id) => (
                    <DropdownMenuItem
                      key={id}
                      className="lg:hidden"
                      onClick={() => setSettings({ generationBackend: id })}
                    >
                      <span className="mr-2">
                        {activeBackend === id ? '●' : '○'}
                      </span>
                      {id}
                      {id === backends.default ? '' : ' (experimental)'}
                    </DropdownMenuItem>
                  ))}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* ── Preview toggle ── */}
          {onTogglePreview && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={previewOpen ? 'default' : 'ghost'}
                  size="icon"
                  className="h-7 w-7"
                  onClick={onTogglePreview}
                >
                  {previewOpen ? (
                    <Eye className="h-3.5 w-3.5" />
                  ) : (
                    <EyeOff className="h-3.5 w-3.5" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span className="flex items-center gap-1.5">
                  {previewOpen ? 'Hide' : 'Show'} Preview{' '}
                  <KbdShortcut shortcut="mod+shift+p" />
                </span>
              </TooltipContent>
            </Tooltip>
          )}

          {/* ── Chat toggle ── */}
          {onToggleChat && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={chatOpen ? 'default' : 'ghost'}
                  size="icon"
                  className="h-7 w-7"
                  onClick={onToggleChat}
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span className="flex items-center gap-1.5">
                  {chatOpen ? 'Close' : 'Open'} AI Chat{' '}
                  <KbdShortcut shortcut="mod+shift+j" />
                </span>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Export-mode dialog — only opens when non-safe fonts are referenced */}
      <ExportModeDialog
        open={exportDialogOpen}
        onClose={() => setExportDialogOpen(false)}
        nonSafeFonts={nonSafeFonts}
        onChoose={handleDownloadWithMode}
      />

      {/* Clipboard-denied fallback: the browser refused the async write, so
          re-offer the JSON behind a fresh click. */}
      <Dialog
        open={standardComponentsFallbackJson != null}
        onOpenChange={(open) => {
          if (!open) setStandardComponentsFallbackJson(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Standard components</DialogTitle>
            <DialogDescription>
              The browser blocked the automatic clipboard write. Copy the JSON
              from here instead.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            readOnly
            value={standardComponentsFallbackJson ?? ''}
            className="h-64 font-mono text-xs"
            onFocus={(e) => e.currentTarget.select()}
          />
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setStandardComponentsFallbackJson(null)}
            >
              Close
            </Button>
            <Button size="sm" onClick={handleCopyFromFallbackDialog}>
              Copy to clipboard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Clear cache confirmation */}
      <Dialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Clear all caches?</DialogTitle>
            <DialogDescription>
              This will clear the document, component, and rasterized-visual
              caches. Next generation will be uncached.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowClearConfirm(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={isClearingCache}
              onClick={async () => {
                await handleClearCache();
                setShowClearConfirm(false);
              }}
            >
              {isClearingCache ? <Spinner size="sm" /> : 'Clear'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export const PreviewHeaderMemoized = React.memo(PreviewHeader);
