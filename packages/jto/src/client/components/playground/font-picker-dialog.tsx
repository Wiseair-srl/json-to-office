import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Copy, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { Alert, AlertDescription } from '../ui/alert';
import { useToast } from '../ui/use-toast';
import { useDocumentsStore } from '../../store/documents-store-provider';
import {
  useFontPickerStore,
  type FontPickerContext,
} from '../../store/font-picker-store';
import { mutateDocumentAtPath } from '../../lib/doc-mutations';
import { UploadsTab, type StoredUserFontView } from './font-picker/uploads-tab';

interface PopularGoogleFont {
  family: string;
  category: 'sans' | 'serif' | 'mono' | 'display' | 'handwriting';
  weights: number[];
  hasItalic: boolean;
}

interface FontCatalog {
  safe: string[];
  google: PopularGoogleFont[];
}

/**
 * The dialog supports two entry points:
 *
 * 1. Theme mode (default) — opened from the preview header's "Browse fonts"
 *    menu. The action buttons write to `theme.fonts.heading` / `theme.fonts.body`
 *    on the active .theme.json file.
 * 2. Contextual mode — opened via the Monaco CodeLens above a font field. The
 *    target JSON path is already known; each card shows a single "Use this
 *    font" button that writes to that path in the active document.
 *
 * Props are still accepted for backward compatibility with direct callers,
 * but the preferred entry point is now the global font-picker-store.
 */
interface FontPickerDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const FALLBACK_CATALOG: FontCatalog = { safe: [], google: [] };

/** Inject a stylesheet link for a Google Font into document.head if missing. */
function ensureGoogleFontLoaded(family: string): void {
  const id = `gf-${family.replace(/\s+/g, '-')}`;
  if (document.getElementById(id)) return;
  const href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(
    family
  )}:wght@400;700&display=swap`;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

/**
 * Read the active theme's text, parse it, apply a mutation, and write back.
 *
 * Font registration only makes sense on themes (theme.fontRegistry) — refuses
 * to mutate when the active tab is a document, prompting the user to open a
 * theme file instead.
 */
function useMutateActiveTheme() {
  const activeTab = useDocumentsStore((s) => s.activeTab);
  const documents = useDocumentsStore((s) => s.documents);
  const documentTypes = useDocumentsStore((s) => s.documentTypes);
  const saveDocument = useDocumentsStore((s) => s.saveDocument);

  return useCallback(
    (fn: (parsed: any) => any) => {
      if (!activeTab) return { ok: false as const, error: 'No active file' };
      if (documentTypes[activeTab] !== 'application/json+theme') {
        return {
          ok: false as const,
          error:
            'Fonts are registered on themes, not documents. Open a .theme.json file and try again.',
        };
      }
      const doc = documents.find((d) => d.name === activeTab);
      if (!doc) return { ok: false as const, error: 'Active theme not found' };
      let parsed: any;
      try {
        parsed = JSON.parse(doc.text);
      } catch (err) {
        return {
          ok: false as const,
          error: `Active theme is not valid JSON: ${(err as Error).message}`,
        };
      }
      const next = fn(parsed);
      saveDocument(activeTab, JSON.stringify(next, null, 2));
      return { ok: true as const, name: activeTab };
    },
    [activeTab, documents, documentTypes, saveDocument]
  );
}

/** Write to an arbitrary JSON path in the active document (contextual mode). */
function useMutateActiveDocumentAtPath() {
  const activeTab = useDocumentsStore((s) => s.activeTab);
  const documents = useDocumentsStore((s) => s.documents);
  const saveDocument = useDocumentsStore((s) => s.saveDocument);

  return useCallback(
    (path: (string | number)[], value: unknown) => {
      if (!activeTab) return { ok: false as const, error: 'No active file' };
      const doc = documents.find((d) => d.name === activeTab);
      if (!doc)
        return { ok: false as const, error: 'Active document not found' };
      let parsed: any;
      try {
        parsed = JSON.parse(doc.text);
      } catch (err) {
        return {
          ok: false as const,
          error: `Active document is not valid JSON: ${(err as Error).message}`,
        };
      }
      const next = mutateDocumentAtPath(parsed, path, value);
      saveDocument(activeTab, JSON.stringify(next, null, 2));
      return { ok: true as const, name: activeTab };
    },
    [activeTab, documents, saveDocument]
  );
}

/** Set theme.fonts.<role> at the root of a theme file. */
function setThemeFont(
  theme: any,
  role: 'heading' | 'body',
  family: string
): void {
  if (!theme.fonts || typeof theme.fonts !== 'object') theme.fonts = {};
  const existing = theme.fonts[role];
  if (existing && typeof existing === 'object') {
    theme.fonts[role] = { ...existing, family };
  } else {
    theme.fonts[role] = family;
  }
}

/** Human-readable summary of the target JSON path for contextual-mode header. */
function formatJsonPath(path: (string | number)[]): string {
  return path
    .map((seg, i) =>
      typeof seg === 'number' ? `[${seg}]` : i === 0 ? seg : `.${seg}`
    )
    .join('');
}

export const FontPickerDialog: React.FC<FontPickerDialogProps> = ({
  open: openProp,
  onOpenChange: onOpenChangeProp,
}) => {
  // Prefer the shared store; fall back to props so existing callers keep working.
  const storeOpen = useFontPickerStore((s) => s.open);
  const storeContextual = useFontPickerStore((s) => s.contextual);
  const storeClose = useFontPickerStore((s) => s.close);

  const open = openProp ?? storeOpen;
  const contextual: FontPickerContext | undefined = storeContextual;

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (onOpenChangeProp) onOpenChangeProp(next);
      if (!next) storeClose();
    },
    [onOpenChangeProp, storeClose]
  );

  const [catalog, setCatalog] = useState<FontCatalog>(FALLBACK_CATALOG);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'safe' | 'google' | 'uploads'>(
    'safe'
  );
  const [applyingFamily, setApplyingFamily] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [uploads, setUploads] = useState<StoredUserFontView[]>([]);

  const { toast } = useToast();
  const mutateTheme = useMutateActiveTheme();
  const mutateDocumentAtPathAction = useMutateActiveDocumentAtPath();
  const activeTabName = useDocumentsStore((s) => s.activeTab);
  const documentTypes = useDocumentsStore((s) => s.documentTypes);
  const isThemeActive =
    activeTabName && documentTypes[activeTabName] === 'application/json+theme';

  // Uploaded fonts work even when no theme file is open (in contextual mode
  // we write to the active document directly). The "Set heading/body" buttons
  // still require a theme, but "Use this font" (contextual) does not.
  const writeEnabled = Boolean(contextual) || isThemeActive;

  useEffect(() => {
    if (!open) return;
    if (catalog.safe.length > 0 || catalog.google.length > 0) return;
    setLoading(true);
    fetch('/api/fonts/catalog')
      .then((r) => r.json())
      .then((data: FontCatalog) => setCatalog(data))
      .catch((err) => {
        toast({
          variant: 'destructive',
          title: 'Font catalog unavailable',
          description: (err as Error).message,
        });
      })
      .finally(() => setLoading(false));
  }, [open, catalog, toast]);

  // Preload Google Fonts in the browser for preview rendering.
  useEffect(() => {
    if (activeTab !== 'google' || catalog.google.length === 0) return;
    for (const f of catalog.google) ensureGoogleFontLoaded(f.family);
  }, [activeTab, catalog]);

  const filteredSafe = useMemo(
    () =>
      catalog.safe.filter((name) =>
        name.toLowerCase().includes(search.toLowerCase())
      ),
    [catalog.safe, search]
  );
  const filteredGoogle = useMemo(
    () =>
      catalog.google.filter((f) =>
        f.family.toLowerCase().includes(search.toLowerCase())
      ),
    [catalog.google, search]
  );
  const filteredUploads = useMemo(
    () =>
      uploads.filter((u) =>
        u.family.toLowerCase().includes(search.toLowerCase())
      ),
    [uploads, search]
  );

  const handleCopy = useCallback(
    async (family: string) => {
      try {
        await navigator.clipboard.writeText(family);
        setCopied(family);
        setTimeout(() => setCopied(null), 1500);
      } catch {
        toast({
          variant: 'destructive',
          title: 'Copy failed',
          description: 'Your browser blocked clipboard write.',
        });
      }
    },
    [toast]
  );

  /** Theme mode: write the family to theme.fonts.heading or theme.fonts.body. */
  const handleInsertTheme = useCallback(
    async (
      family: string,
      source: 'safe' | 'google' | 'uploads',
      role: 'heading' | 'body'
    ) => {
      setApplyingFamily(family);
      try {
        const result = mutateTheme((theme) => {
          setThemeFont(theme, role, family);
          return theme;
        });
        if (!result.ok) {
          toast({
            variant: 'destructive',
            title: 'Could not insert font',
            description: result.error,
          });
          return;
        }
        toast({
          title: 'Font inserted',
          description:
            source === 'google'
              ? `${family} set as ${role}. Preview embeds it automatically; production builds must register via fonts.extraEntries.`
              : source === 'uploads'
                ? `${family} set as ${role}. Font embeds from your browser upload on next generate.`
                : `${family} set as ${role} font in "${result.name}".`,
        });
      } finally {
        setApplyingFamily(null);
      }
    },
    [mutateTheme, toast]
  );

  /** Contextual mode: write the family at the CodeLens target path. */
  const handleInsertContextual = useCallback(
    async (family: string) => {
      if (!contextual) return;
      setApplyingFamily(family);
      try {
        const result = mutateDocumentAtPathAction(contextual.jsonPath, family);
        if (!result.ok) {
          toast({
            variant: 'destructive',
            title: 'Could not insert font',
            description: result.error,
          });
          return;
        }
        toast({
          title: 'Font inserted',
          description: `${family} set at ${formatJsonPath(contextual.jsonPath)}.`,
        });
        handleOpenChange(false);
      } finally {
        setApplyingFamily(null);
      }
    },
    [contextual, mutateDocumentAtPathAction, toast, handleOpenChange]
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {contextual
              ? `Font for ${formatJsonPath(contextual.jsonPath)}`
              : 'Fonts'}
          </DialogTitle>
        </DialogHeader>

        {!contextual && !isThemeActive && (
          <Alert>
            <AlertDescription>
              Fonts are registered on themes. Open a <code>.theme.json</code>{' '}
              file to apply a font — the buttons below are disabled until you
              do.
            </AlertDescription>
          </Alert>
        )}

        <Tabs
          value={activeTab}
          onValueChange={(v) =>
            setActiveTab(v as 'safe' | 'google' | 'uploads')
          }
          className="flex-1 overflow-hidden flex flex-col"
        >
          <div className="flex items-center gap-2">
            <TabsList>
              <TabsTrigger value="safe">
                Safe
                <Badge variant="secondary" className="ml-1 text-xs px-1 py-0">
                  {catalog.safe.length}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="google">
                Google
                <Badge variant="secondary" className="ml-1 text-xs px-1 py-0">
                  {catalog.google.length}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="uploads">
                Uploads
                <Badge variant="secondary" className="ml-1 text-xs px-1 py-0">
                  {uploads.length}
                </Badge>
              </TabsTrigger>
            </TabsList>
            <Input
              type="search"
              placeholder="Search fonts..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="ml-auto max-w-xs"
            />
          </div>

          <div className="flex-1 overflow-auto mt-4 pr-2">
            <TabsContent value="safe" className="m-0">
              {loading && filteredSafe.length === 0 ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground">
                  <Loader2 className="animate-spin mr-2" /> Loading catalog...
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {filteredSafe.map((name) => (
                    <FontCard
                      key={name}
                      family={name}
                      meta={
                        <span className="text-xs">Installed with Office</span>
                      }
                      previewStyle={{ fontFamily: `"${name}", sans-serif` }}
                      onCopy={() => handleCopy(name)}
                      copied={copied === name}
                      contextual={Boolean(contextual)}
                      onUseThis={() => handleInsertContextual(name)}
                      onInsertHeading={() =>
                        handleInsertTheme(name, 'safe', 'heading')
                      }
                      onInsertBody={() =>
                        handleInsertTheme(name, 'safe', 'body')
                      }
                      applying={applyingFamily === name}
                      disabled={!writeEnabled}
                    />
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="google" className="m-0">
              {loading && filteredGoogle.length === 0 ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground">
                  <Loader2 className="animate-spin mr-2" /> Loading catalog...
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {filteredGoogle.map((f) => (
                    <FontCard
                      key={f.family}
                      family={f.family}
                      meta={
                        <span className="text-xs">
                          {f.category} · {f.weights.length} weights
                        </span>
                      }
                      previewStyle={{ fontFamily: `"${f.family}", sans-serif` }}
                      onCopy={() => handleCopy(f.family)}
                      copied={copied === f.family}
                      contextual={Boolean(contextual)}
                      onUseThis={() => handleInsertContextual(f.family)}
                      onInsertHeading={() =>
                        handleInsertTheme(f.family, 'google', 'heading')
                      }
                      onInsertBody={() =>
                        handleInsertTheme(f.family, 'google', 'body')
                      }
                      applying={applyingFamily === f.family}
                      disabled={!writeEnabled}
                    />
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="uploads" className="m-0">
              <UploadsTab
                search={search}
                filtered={filteredUploads}
                onListChange={setUploads}
                renderCard={(upload) => (
                  <FontCard
                    key={upload.id}
                    family={upload.family}
                    meta={
                      <span className="text-xs">
                        {upload.format.toUpperCase()} ·{' '}
                        {upload.italic ? 'italic ' : ''}weight {upload.weight}
                      </span>
                    }
                    previewStyle={{
                      fontFamily: `"${upload.family}", sans-serif`,
                      fontWeight: upload.weight,
                      fontStyle: upload.italic ? 'italic' : 'normal',
                    }}
                    onCopy={() => handleCopy(upload.family)}
                    copied={copied === upload.family}
                    contextual={Boolean(contextual)}
                    onUseThis={() => handleInsertContextual(upload.family)}
                    onInsertHeading={() =>
                      handleInsertTheme(upload.family, 'uploads', 'heading')
                    }
                    onInsertBody={() =>
                      handleInsertTheme(upload.family, 'uploads', 'body')
                    }
                    applying={applyingFamily === upload.family}
                    disabled={!writeEnabled}
                    extraAction={
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={upload.onDelete}
                        aria-label={`Delete ${upload.family}`}
                      >
                        Delete
                      </Button>
                    }
                  />
                )}
              />
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};

const PANGRAM = 'The quick brown fox jumps over the lazy dog';

interface FontCardProps {
  family: string;
  meta: React.ReactNode;
  previewStyle: React.CSSProperties;
  onCopy: () => void;
  copied: boolean;
  contextual: boolean;
  onUseThis: () => void;
  onInsertHeading: () => void;
  onInsertBody: () => void;
  applying: boolean;
  disabled?: boolean;
  extraAction?: React.ReactNode;
}

const FontCard: React.FC<FontCardProps> = ({
  family,
  meta,
  previewStyle,
  onCopy,
  copied,
  contextual,
  onUseThis,
  onInsertHeading,
  onInsertBody,
  applying,
  disabled,
  extraAction,
}) => (
  <div className="border rounded-md p-3 flex flex-col gap-2 bg-card">
    <div className="flex items-baseline justify-between gap-2">
      <div className="font-medium truncate">{family}</div>
      <div className="text-muted-foreground">{meta}</div>
    </div>
    <div className="text-lg truncate" style={previewStyle} aria-hidden>
      {PANGRAM}
    </div>
    <div className="flex items-center gap-2 mt-1">
      {contextual ? (
        <Button
          size="sm"
          onClick={onUseThis}
          disabled={applying || disabled}
          aria-label={`Use ${family} at the target path`}
        >
          Use this font
        </Button>
      ) : (
        <>
          <Button
            size="sm"
            variant="secondary"
            onClick={onInsertHeading}
            disabled={applying || disabled}
            aria-label={`Set ${family} as heading font`}
          >
            Set heading
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={onInsertBody}
            disabled={applying || disabled}
            aria-label={`Set ${family} as body font`}
          >
            Set body
          </Button>
        </>
      )}
      {extraAction}
      <Button
        size="sm"
        variant="ghost"
        className="ml-auto"
        onClick={onCopy}
        aria-label={`Copy ${family}`}
      >
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </Button>
    </div>
  </div>
);
