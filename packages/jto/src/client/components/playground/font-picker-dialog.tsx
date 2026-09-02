import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Check, Copy, Loader2, Upload } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { Alert, AlertDescription } from '../ui/alert';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { useToast } from '../ui/use-toast';
import { useDocumentsStore } from '../../store/documents-store-provider';
import { currentDocumentText } from '../../lib/active-document-text';
import {
  useFontPickerStore,
  type FontPickerContext,
} from '../../store/font-picker-store';
import { mutateDocumentAtPath } from '../../lib/doc-mutations';
import { WEIGHT_LABELS, type FontRegistryEntry } from '@json-to-office/shared';
import { API_ENDPOINTS } from '../../config/api';
import {
  validateFontUpload,
  guessFontIdentity,
  mergeFontEntriesIntoRegistry,
  materializeResponseToEntry,
  checkDocumentSize,
  type MaterializeResponse,
} from '../../lib/font-upload';
import {
  ensureDataFontLoaded,
  ensureGoogleFontLoaded,
} from '../../lib/font-face-inject';

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
      const text = currentDocumentText(activeTab, doc.text);
      let parsed: any;
      try {
        parsed = JSON.parse(text);
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
      const text = currentDocumentText(activeTab, doc.text);
      let parsed: any;
      try {
        parsed = JSON.parse(text);
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

/**
 * Append fonts to the active *document*'s `props.fontRegistry`.
 *
 * Deliberately the document and not the theme: an uploaded font travels as
 * bytes inside the JSON, and the document is what gets generated, exported,
 * and re-imported. Sources for a family are merged so re-uploading one weight
 * does not discard the others.
 *
 * Takes a *list* of entries and writes them in a single save. The callback
 * closes over the store's `documents` snapshot, so calling it once per
 * uploaded file would re-parse the same pre-upload text each time and every
 * save would clobber the previous one — three dropped fonts would leave one.
 */
function useMutateActiveDocumentFontRegistry() {
  const activeTab = useDocumentsStore((s) => s.activeTab);
  const documents = useDocumentsStore((s) => s.documents);
  const documentTypes = useDocumentsStore((s) => s.documentTypes);
  const saveDocument = useDocumentsStore((s) => s.saveDocument);

  return useCallback(
    (entries: FontRegistryEntry[]) => {
      if (entries.length === 0) return { ok: true as const, name: activeTab };
      if (!activeTab) return { ok: false as const, error: 'No active file' };
      if (documentTypes[activeTab] === 'application/json+theme') {
        return {
          ok: false as const,
          error:
            'Custom fonts are registered on the document, not the theme. Open the .docx.json / .pptx.json tab and try again.',
        };
      }
      const doc = documents.find((d) => d.name === activeTab);
      if (!doc)
        return { ok: false as const, error: 'Active document not found' };
      const text = currentDocumentText(activeTab, doc.text);
      let parsed: any;
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        return {
          ok: false as const,
          error: `Active document is not valid JSON: ${(err as Error).message}`,
        };
      }
      const merged = mergeFontEntriesIntoRegistry(
        parsed?.props?.fontRegistry,
        entries
      );
      const next = mutateDocumentAtPath(
        parsed,
        ['props', 'fontRegistry'],
        merged
      );
      const json = JSON.stringify(next, null, 2);
      const sizeError = checkDocumentSize(json);
      if (sizeError) return { ok: false as const, error: sizeError };
      saveDocument(activeTab, json);
      return { ok: true as const, name: activeTab };
    },
    [activeTab, documents, documentTypes, saveDocument]
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
  const [activeTab, setActiveTab] = useState<'safe' | 'google' | 'custom'>(
    'safe'
  );
  const [applyingFamily, setApplyingFamily] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [materializeBusy, setMaterializeBusy] = useState(false);
  const [gfFamily, setGfFamily] = useState('');
  const [lastWarnings, setLastWarnings] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { toast } = useToast();
  const mutateTheme = useMutateActiveTheme();
  const mutateDocumentAtPathAction = useMutateActiveDocumentAtPath();
  const mutateFontRegistry = useMutateActiveDocumentFontRegistry();
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
    fetch(API_ENDPOINTS.fonts.catalog)
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
    for (const f of catalog.google) ensureGoogleFontLoaded(f.family, f.weights);
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
      _source: 'safe' | 'google',
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
          description: `${family} set as ${role} font in "${result.name}".`,
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

  const handleUploadFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      setUploadBusy(true);
      try {
        // Validate every file first, then write all of them in one save. A
        // per-file write would re-parse the same stale document text each
        // time and keep only the last font.
        const accepted: {
          identity: ReturnType<typeof guessFontIdentity>;
          base64: string;
        }[] = [];
        for (const file of Array.from(files)) {
          const bytes = new Uint8Array(await file.arrayBuffer());
          const result = validateFontUpload(file.name, bytes);
          if (!result.ok) {
            toast({
              variant: 'destructive',
              title: 'Font rejected',
              description: result.message,
            });
            continue;
          }
          accepted.push({
            identity: guessFontIdentity(file.name),
            base64: result.base64,
          });
        }
        if (accepted.length === 0) return;

        const written = mutateFontRegistry(
          accepted.map(({ identity, base64 }) => ({
            id: identity.family,
            family: identity.family,
            sources: [
              {
                kind: 'data' as const,
                data: base64,
                weight: identity.weight,
                italic: identity.italic,
              },
            ],
          }))
        );
        if (!written.ok) {
          toast({
            variant: 'destructive',
            title: 'Could not register font',
            description: written.error,
          });
          return;
        }
        for (const { identity, base64 } of accepted) {
          void ensureDataFontLoaded(
            identity.family,
            base64,
            identity.weight,
            identity.italic
          );
          toast({
            title: `Added ${identity.family}`,
            description: `Registered at weight ${identity.weight}${
              identity.italic ? ' italic' : ''
            } in props.fontRegistry. Reference it as "${identity.family}".`,
          });
        }
      } catch (err) {
        toast({
          variant: 'destructive',
          title: 'Upload failed',
          description: (err as Error).message,
        });
      } finally {
        setUploadBusy(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    },
    [mutateFontRegistry, toast]
  );

  const handleMaterialize = useCallback(async () => {
    const family = gfFamily.trim();
    if (!family) return;
    setMaterializeBusy(true);
    setLastWarnings([]);
    try {
      const res = await fetch(API_ENDPOINTS.fonts.materialize, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ family, weights: [400, 700], italics: false }),
      });
      if (res.status === 429) {
        throw new Error(
          'Too many font fetches — the playground allows 20 every 15 minutes. Try again shortly.'
        );
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `Materialize failed (${res.status})`);
      }
      const data = (await res.json()) as MaterializeResponse;
      setLastWarnings(data.warnings ?? []);

      const category = catalog.google.find(
        (f) => f.family.toLowerCase() === data.family.toLowerCase()
      )?.category;
      const entry = materializeResponseToEntry(data, category);
      if (!entry) {
        // The route answers 200 with an empty `sources` for an unknown
        // family, and the schema requires at least one source.
        toast({
          variant: 'destructive',
          title: 'Nothing to embed',
          description:
            data.warnings?.join(' · ') ||
            `Google Fonts has no family named "${family}".`,
        });
        return;
      }
      const written = mutateFontRegistry([entry]);
      if (!written.ok) {
        toast({
          variant: 'destructive',
          title: 'Could not register font',
          description: written.error,
        });
        return;
      }
      ensureGoogleFontLoaded(data.family, [400, 700]);
      toast({
        title: `Added ${data.family}`,
        description: `Embedded ${entry.sources.length} weight(s) in props.fontRegistry.`,
      });
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Google Fonts fetch failed',
        description: (err as Error).message,
      });
    } finally {
      setMaterializeBusy(false);
    }
  }, [gfFamily, catalog.google, mutateFontRegistry, toast]);

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

        {!contextual && !isThemeActive && activeTab !== 'custom' && (
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
          onValueChange={(v) => setActiveTab(v as 'safe' | 'google' | 'custom')}
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
              <TabsTrigger value="custom">Custom</TabsTrigger>
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
                      extraAction={
                        <GoogleVariantsMenu
                          family={f.family}
                          weights={f.weights}
                          hasItalic={f.hasItalic}
                        />
                      }
                    />
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="custom" className="m-0 flex flex-col gap-6">
              {isThemeActive ? (
                <Alert>
                  <AlertDescription>
                    Custom fonts are stored on the document (
                    <code>props.fontRegistry</code>), because the bytes travel
                    with the JSON. Open a document tab to add one.
                  </AlertDescription>
                </Alert>
              ) : (
                <>
                  <section className="flex flex-col gap-2">
                    <h3 className="text-sm font-medium">Upload a font file</h3>
                    <p className="text-xs text-muted-foreground">
                      TTF or OTF, up to 2 MB each. The font is embedded in the
                      document as base64, so it survives export and re-import —
                      and renders in the preview. The family and weight are
                      guessed from the filename (e.g.{' '}
                      <code>Geist-SemiBold.ttf</code>).
                    </p>
                    <div
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        void handleUploadFiles(e.dataTransfer.files);
                      }}
                      className="rounded-md border border-dashed p-6 text-center"
                    >
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".ttf,.otf,font/ttf,font/otf"
                        multiple
                        className="hidden"
                        onChange={(e) => void handleUploadFiles(e.target.files)}
                      />
                      <Button
                        variant="secondary"
                        disabled={uploadBusy}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        {uploadBusy ? (
                          <Loader2 className="animate-spin mr-2 h-4 w-4" />
                        ) : (
                          <Upload className="mr-2 h-4 w-4" />
                        )}
                        Choose font files
                      </Button>
                      <p className="mt-2 text-xs text-muted-foreground">
                        or drop them here
                      </p>
                    </div>
                  </section>

                  <section className="flex flex-col gap-2">
                    <h3 className="text-sm font-medium">
                      Embed any Google font
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Not limited to the {catalog.google.length} curated
                      families — type any Google Fonts family name and its
                      regular and bold weights are fetched and embedded.
                    </p>
                    <div className="flex gap-2">
                      <Input
                        placeholder="e.g. Geist"
                        value={gfFamily}
                        onChange={(e) => setGfFamily(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void handleMaterialize();
                        }}
                      />
                      <Button
                        onClick={() => void handleMaterialize()}
                        disabled={materializeBusy || gfFamily.trim() === ''}
                      >
                        {materializeBusy && (
                          <Loader2 className="animate-spin mr-2 h-4 w-4" />
                        )}
                        Embed
                      </Button>
                    </div>
                    {lastWarnings.length > 0 && (
                      <Alert>
                        <AlertDescription className="text-xs">
                          {lastWarnings.join(' · ')}
                        </AlertDescription>
                      </Alert>
                    )}
                  </section>
                </>
              )}
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};

const PANGRAM = 'The quick brown fox jumps over the lazy dog';

/**
 * Read-only variants disclosure for Google Fonts cards. Google families aren't
 * deletable like uploads, but users still need to see which weights exist and
 * what they look like before committing to `fontWeight: <n>` in their JSON.
 *
 * Requires the relevant @font-face rules to already be loaded (handled by the
 * parent's `ensureGoogleFontLoaded(family, weights)` effect).
 */
const GoogleVariantsMenu: React.FC<{
  family: string;
  weights: number[];
  hasItalic: boolean;
}> = ({ family, weights, hasItalic }) => {
  const sorted = useMemo(() => [...weights].sort((a, b) => a - b), [weights]);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost" aria-label="Show variants">
          Variants
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[260px]">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          {sorted.length} weight{sorted.length === 1 ? '' : 's'}
          {hasItalic ? ' · italic available' : ''}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {sorted.map((w) => {
          const label = WEIGHT_LABELS[w] ?? String(w);
          return (
            <div key={w} className="flex flex-col gap-0.5 px-2 py-1.5">
              <span
                className="truncate"
                style={{
                  fontFamily: `"${family}", sans-serif`,
                  fontWeight: w,
                }}
              >
                {label}
              </span>
              <span className="text-xs text-muted-foreground font-mono">
                fontWeight: {w}
              </span>
            </div>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

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
