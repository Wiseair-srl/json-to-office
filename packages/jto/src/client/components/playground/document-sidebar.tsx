import {
  Fragment,
  useCallback,
  useState,
  useMemo,
  memo,
  useEffect,
  useRef,
  useContext,
} from 'react';
import {
  GitCompareArrows,
  Plus,
  Search,
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from 'lucide-react';
import { CompareDocumentsDialog } from './compare-documents-dialog';
import { FORMAT } from '../../lib/env';
import { DocumentFormDialogContentMemoized } from './document-form-dialog-content';
import { DocumentMenuItemMemoized } from './document-menu-item';
import { OutlinePanel } from './outline-panel';
import { PluginSelector } from './plugin-selector';
import {
  LibraryRow,
  LocationDivider,
  PluginsSection,
  useLocationGroups,
} from './sidebar-library';
import {
  EmptyRow,
  RailIconButton,
  SectionLabel,
  matchesQuery,
} from './sidebar-shared';
import { Dialog, DialogContent } from '../ui/dialog';
import { Kbd, KbdShortcut } from '../ui/kbd';
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarFooter,
  SidebarMenu,
} from '../ui/sidebar';
import { useDocumentsStore } from '../../store/documents-store-provider';
import {
  useThemesStore,
  ThemesStoreContext,
} from '../../store/themes-store-provider';
import type { DiscoveryResult } from '../../hooks/useDiscovery';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '../../lib/utils';
import { ButtonModeToggle } from '../mode-toggle';
import { useTheme } from '../theme-provider';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { useToast } from '../ui/use-toast';
import { usePluginsStore } from '../../store/plugins-store';

interface DocumentSidebarProps {
  discoveryData: DiscoveryResult | null;
  onToggleSidebar?: () => void;
  isCollapsed?: boolean;
  isAnimating?: boolean;
}

/**
 * Playground rail.
 *
 * One section per kind — Documents, Themes, Plugins — and nothing below the
 * filter is rendered twice. Open-ness is a property of a row, not a region:
 * files you have open sort to the top of their kind and carry the state
 * marker, files still on disk sit under them and reveal a `+`. The rail used
 * to split those into separate sections, which put `contract-v1` on screen
 * twice and cost six eyebrows to say three things.
 *
 * The outline is not a fourth section: it is the active document's own
 * structure, so it hangs off that document's row. Plugins are a per-run
 * setting rather than a file, so they sit last, below the hairline, folded.
 *
 * A single filter across the top cuts through everything — with a dozen
 * documents, themes and plugins in a 256px column, scanning was the slowest
 * thing about this panel.
 *
 * Colour is rationed. `--primary` marks the row the editor has open,
 * `--data-blue` the one in the preview, `--warning` a theme that preview is
 * using, `--accent2` the theme category. Nothing else in the rail is tinted, so
 * those four always mean something.
 */
function DocumentSidebarComponent({
  discoveryData,
  onToggleSidebar,
  isCollapsed = false,
  isAnimating = false,
}: DocumentSidebarProps) {
  const { documents, documentTypes, createDocument, openDocument, activeTab } =
    useDocumentsStore(
      useShallow((state) => ({
        documents: state.documents,
        documentTypes: state.documentTypes,
        createDocument: state.createDocument,
        openDocument: state.openDocument,
        activeTab: state.activeTab,
      }))
    );
  const updateTheme = useThemesStore((state) => state.updateTheme);
  const removeTheme = useThemesStore((state) => state.removeTheme);
  const themesStoreApi = useContext(ThemesStoreContext);
  const [dialogOpen, setDialogOpen] = useState<boolean>(false);
  const [themeDialogOpen, setThemeDialogOpen] = useState<boolean>(false);
  const [pluginSelectorOpen, setPluginSelectorOpen] = useState<boolean>(false);
  const [pluginSelectorFocusedPlugin, setPluginSelectorFocusedPlugin] =
    useState<string | null>(null);
  const togglePlugin = usePluginsStore((state) => state.togglePlugin);
  const isPluginSelected = usePluginsStore((state) => state.isPluginSelected);
  const selectedPlugins = usePluginsStore((state) => state.selectedPlugins);
  const isApplyingPlugins = usePluginsStore((state) => state.isApplyingPlugins);
  const [compareDialogOpen, setCompareDialogOpen] = useState(false);
  // Files open; plugins folded until you go looking for them.
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    new Set(['documents', 'themes'])
  );
  const [query, setQuery] = useState('');
  const filterRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  // Separate documents and themes
  const reportDocuments = documents.filter(
    (doc) => documentTypes[doc.name] !== 'application/json+theme'
  );
  const themeDocuments = documents.filter(
    (doc) => documentTypes[doc.name] === 'application/json+theme'
  );

  const closeDialog = useCallback(() => {
    setDialogOpen(false);
  }, []);

  const closeThemeDialog = useCallback(() => {
    setThemeDialogOpen(false);
  }, []);

  // Track previous theme documents to detect changes
  const prevThemeDocsRef = useRef<Map<string, string>>(new Map());

  // Sync theme documents to the themes store (add, update, and remove)
  useEffect(() => {
    const prevThemeDocs = prevThemeDocsRef.current;
    const currentThemeDocs = new Map<string, string>();

    // Add/update changed themes
    themeDocuments.forEach((themeDoc) => {
      currentThemeDocs.set(themeDoc.name, themeDoc.text);
      const prevContent = prevThemeDocs.get(themeDoc.name);
      if (prevContent !== themeDoc.text) {
        updateTheme(themeDoc.name, themeDoc.text);
      }
    });

    // Remove themes whose documents were deleted
    prevThemeDocs.forEach((_, name) => {
      if (!currentThemeDocs.has(name)) {
        removeTheme(name);
      }
    });

    prevThemeDocsRef.current = currentThemeDocs;
  }, [themeDocuments, updateTheme, removeTheme]);

  // One-time reconciliation: clean up IDB orphans from historical sync gaps
  const reconciled = useRef(false);
  useEffect(() => {
    if (reconciled.current || !themesStoreApi) return;
    reconciled.current = true;
    const currentNames = new Set(themeDocuments.map((d) => d.name));
    const storeKeys = Object.keys(themesStoreApi.getState().customThemes);
    storeKeys.forEach((key) => {
      if (!currentNames.has(key)) removeTheme(key);
    });
  }, [themeDocuments, removeTheme, themesStoreApi]);

  const toggleGroup = useCallback((groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);

  const { resolvedTheme } = useTheme();
  const logoSrc =
    resolvedTheme === 'dark'
      ? 'https://ik.imagekit.io/wiseair/Brand%20assets/wiseair-logo-white.svg?updatedAt=1751359555877'
      : 'https://ik.imagekit.io/wiseair/Brand%20assets/wiseair-logo.svg?updatedAt=1749817149276';

  // Quick-add a discovered resource as an active document
  const handleQuickAdd = useCallback(
    async (name: string, isTheme: boolean) => {
      // Check if already exists
      if (documents.some((d) => d.name === name)) {
        openDocument(name);
        return;
      }

      try {
        const res = await fetch(
          `/api/discovery/${isTheme ? 'themes' : 'documents'}/${encodeURIComponent(name)}/content`
        );
        if (!res.ok) throw new Error(res.statusText);
        const content = await res.text();
        const parsed = JSON.parse(content);
        // Record provenance so generate/preview keep resolving the template's
        // bundled media/fonts (options.sourceName) after the user renames it.
        createDocument(name, JSON.stringify(parsed, null, 2), {
          templateSource: name,
        });
        openDocument(name);
        toast({ title: `Added ${isTheme ? 'theme' : 'document'}: ${name}` });
      } catch {
        toast({
          title: 'Failed to load',
          description: `Could not load ${name}`,
          variant: 'destructive',
        });
      }
    },
    [documents, createDocument, openDocument, toast]
  );

  // `/` jumps to the filter, the convention in every editor-shaped app. Guarded
  // against text targets so it never steals a slash you meant to type.
  useEffect(() => {
    if (isCollapsed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName?.toLowerCase();
      if (
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        el?.isContentEditable ||
        el?.closest?.('.monaco-editor')
      ) {
        return;
      }
      // A modal is open: Radix marks everything outside the portal
      // aria-hidden/inert, so focusing the filter would swallow the keystroke
      // and move nothing. Testing the input itself also covers the rename and
      // delete dialogs, which belong to the row components rather than to this
      // one — guarding on local dialog state would miss them.
      if (filterRef.current?.closest('[aria-hidden="true"], [inert]')) return;
      e.preventDefault();
      filterRef.current?.focus();
      filterRef.current?.select();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isCollapsed]);

  const q = query.trim();
  const openNames = useMemo(
    () => new Set(documents.map((d) => d.name)),
    [documents]
  );

  const visibleDocuments = useMemo(
    () => reportDocuments.filter((d) => matchesQuery(d.name, q)),
    [reportDocuments, q]
  );
  const visibleThemes = useMemo(
    () => themeDocuments.filter((d) => matchesQuery(d.name, q)),
    [themeDocuments, q]
  );
  // Discovered files that are not already open above them: an open file is
  // one row in one place, and "jump to the copy you already have" was never
  // worth a second row to say.
  const libraryDocuments = useMemo(
    () =>
      (discoveryData?.documents ?? []).filter(
        (d) =>
          !openNames.has(d.name) &&
          (matchesQuery(d.name, q) || matchesQuery(d.title ?? '', q))
      ),
    [discoveryData, q, openNames]
  );
  const libraryThemes = useMemo(
    () =>
      (discoveryData?.themes ?? []).filter(
        (t) =>
          !openNames.has(t.name) &&
          (matchesQuery(t.name, q) || matchesQuery(t.description ?? '', q))
      ),
    [discoveryData, q, openNames]
  );
  const documentLocations = useLocationGroups(libraryDocuments);
  const themeLocations = useLocationGroups(libraryThemes);
  const libraryPlugins = useMemo(
    () =>
      (discoveryData?.plugins ?? []).filter(
        (p) => matchesQuery(p.name, q) || matchesQuery(p.description ?? '', q)
      ),
    [discoveryData, q]
  );

  // A live filter that leaves its matches folded away is a filter that does
  // nothing, so a query forces every section open.
  const isSectionOpen = (id: string) => q.length > 0 || expandedGroups.has(id);
  const documentsOpen = isSectionOpen('documents');
  const themesOpen = isSectionOpen('themes');
  const documentCount = visibleDocuments.length + libraryDocuments.length;
  const themeCount = visibleThemes.length + libraryThemes.length;

  const nothingMatches =
    q.length > 0 &&
    visibleDocuments.length === 0 &&
    visibleThemes.length === 0 &&
    libraryDocuments.length === 0 &&
    libraryThemes.length === 0 &&
    libraryPlugins.length === 0;

  const fade = cn(
    'transition-opacity duration-150 ease-out',
    isAnimating ? 'opacity-0' : 'opacity-100'
  );

  return (
    <>
      <Sidebar
        collapsible="none"
        style={{ ['--sidebar-width' as any]: isCollapsed ? '3rem' : '16rem' }}
      >
        {isCollapsed ? (
          /* ---------------------------------------------------------------
           * Collapsed rail. Real file icons rather than two-letter monograms:
           * `contract-v1` and `contract-v2` both reduced to "CO", which made
           * the compact rail unreadable exactly when it needed to be scannable.
           * ------------------------------------------------------------- */
          <>
            <SidebarHeader className={cn('gap-0 p-1.5', fade)}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <RailIconButton
                    className="mx-auto size-7"
                    aria-label="Expand sidebar"
                    aria-expanded={false}
                    onClick={onToggleSidebar}
                  >
                    <PanelLeftOpen />
                  </RailIconButton>
                </TooltipTrigger>
                <TooltipContent
                  side="right"
                  className="flex items-center gap-2"
                >
                  <span>Expand sidebar</span>
                  <KbdShortcut shortcut="mod+b" />
                </TooltipContent>
              </Tooltip>
            </SidebarHeader>
            <SidebarContent className={cn('gap-2 px-1 py-1', fade)}>
              <SidebarMenu className="items-center gap-0.5">
                {reportDocuments.map((doc) => (
                  <DocumentMenuItemMemoized
                    key={doc.name}
                    document={doc}
                    compact
                  />
                ))}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <RailIconButton
                      className="size-7"
                      aria-label="New document"
                      onClick={() => setDialogOpen(true)}
                    >
                      <Plus />
                    </RailIconButton>
                  </TooltipTrigger>
                  <TooltipContent side="right">New document</TooltipContent>
                </Tooltip>
              </SidebarMenu>

              <div className="bg-sidebar-border/70 mx-auto h-px w-6" />

              <SidebarMenu className="items-center gap-0.5">
                {themeDocuments.map((doc) => (
                  <DocumentMenuItemMemoized
                    key={doc.name}
                    document={doc}
                    compact
                  />
                ))}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <RailIconButton
                      className="size-7"
                      aria-label="New theme"
                      onClick={() => setThemeDialogOpen(true)}
                    >
                      <Plus />
                    </RailIconButton>
                  </TooltipTrigger>
                  <TooltipContent side="right">New theme</TooltipContent>
                </Tooltip>
              </SidebarMenu>
            </SidebarContent>
          </>
        ) : (
          /* -----------------------------------------------------------------
           * Expanded rail.
           * --------------------------------------------------------------- */
          <>
            <SidebarHeader className={cn('gap-0 p-2', fade)}>
              <div className="flex h-7 items-center justify-between gap-1">
                <a
                  href="/"
                  aria-label="JSON to Office home"
                  className="focus-visible:ring-sidebar-ring flex items-center rounded-sm pl-1 focus-visible:ring-1 focus-visible:outline-none"
                >
                  <img
                    src={logoSrc}
                    alt="Wiseair"
                    className="h-[18px] w-auto max-w-[110px] shrink-0"
                  />
                </a>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <RailIconButton
                      aria-label="Collapse sidebar"
                      aria-expanded={true}
                      onClick={onToggleSidebar}
                    >
                      <PanelLeftClose />
                    </RailIconButton>
                  </TooltipTrigger>
                  <TooltipContent
                    side="right"
                    className="flex items-center gap-2"
                  >
                    <span>Collapse sidebar</span>
                    <KbdShortcut shortcut="mod+b" />
                  </TooltipContent>
                </Tooltip>
              </div>

              {/* One filter for the whole rail: open files, project files and
                  plugins all narrow together. */}
              <div className="relative mt-2">
                <Search
                  aria-hidden
                  className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-sidebar-foreground/40"
                />
                <input
                  ref={filterRef}
                  type="text"
                  value={query}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder="Filter files…"
                  aria-label="Filter documents, themes and plugins"
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      setQuery('');
                      e.currentTarget.blur();
                    }
                  }}
                  className={cn(
                    'border-sidebar-border/70 bg-sidebar-accent/40 h-7 w-full rounded-sm border',
                    'pr-7 pl-7 text-[13px] text-sidebar-foreground transition-colors',
                    'placeholder:text-sidebar-foreground/60',
                    'focus-visible:border-sidebar-ring focus-visible:bg-sidebar-accent/60',
                    'focus-visible:ring-sidebar-ring focus-visible:ring-1 focus-visible:outline-none'
                  )}
                />
                {q ? (
                  <RailIconButton
                    aria-label="Clear filter"
                    onClick={() => {
                      setQuery('');
                      filterRef.current?.focus();
                    }}
                    className="absolute top-1/2 right-1 -translate-y-1/2"
                  >
                    <X />
                  </RailIconButton>
                ) : (
                  <Kbd className="absolute top-1/2 right-1.5 h-4 min-w-4 -translate-y-1/2 bg-transparent px-0 text-[10px] text-sidebar-foreground/65">
                    /
                  </Kbd>
                )}
              </div>
            </SidebarHeader>

            <SidebarContent className={cn('gap-0 px-2 pb-2', fade)}>
              {nothingMatches ? (
                <div className="px-1 py-6 text-center">
                  <p className="text-[13px] text-sidebar-foreground/70">
                    No files match “{q}”
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setQuery('');
                      filterRef.current?.focus();
                    }}
                    className="text-sidebar-foreground/70 hover:text-sidebar-foreground focus-visible:ring-sidebar-ring mt-1 cursor-pointer rounded-sm text-[12px] underline-offset-2 hover:underline focus-visible:ring-1 focus-visible:outline-none"
                  >
                    Clear filter
                  </button>
                </div>
              ) : (
                <>
                  {/* Documents: the ones you have open, then the ones the
                      project has on disk, in one list. */}
                  {(documentCount > 0 || !q) && (
                    <section>
                      <SectionLabel
                        open={documentsOpen}
                        onToggle={() => toggleGroup('documents')}
                        count={documentCount || undefined}
                        actions={
                          <>
                            {FORMAT === 'docx' && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <RailIconButton
                                    aria-label="Compare documents"
                                    disabled={reportDocuments.length < 2}
                                    onClick={() => setCompareDialogOpen(true)}
                                  >
                                    <GitCompareArrows />
                                  </RailIconButton>
                                </TooltipTrigger>
                                <TooltipContent side="bottom">
                                  {reportDocuments.length < 2
                                    ? 'Compare needs two documents'
                                    : 'Compare documents (redline)'}
                                </TooltipContent>
                              </Tooltip>
                            )}
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <RailIconButton
                                  aria-label="New document"
                                  onClick={() => setDialogOpen(true)}
                                >
                                  <Plus />
                                </RailIconButton>
                              </TooltipTrigger>
                              <TooltipContent side="bottom">
                                New document
                              </TooltipContent>
                            </Tooltip>
                          </>
                        }
                      >
                        Documents
                      </SectionLabel>
                      {documentsOpen && (
                        <SidebarMenu className="gap-0.5">
                          {visibleDocuments.map((doc) => (
                            <Fragment key={doc.name}>
                              <DocumentMenuItemMemoized
                                document={doc}
                                query={q}
                              />
                              {/* The outline belongs to this row. Hidden while
                                  the filter is live — the filter is about
                                  files, and the rows go to the matches. */}
                              {!q && activeTab === doc.name && <OutlinePanel />}
                            </Fragment>
                          ))}
                          {documentLocations.map(([location, docs]) => (
                            <Fragment key={location}>
                              {documentLocations.length > 1 && (
                                <LocationDivider location={location} />
                              )}
                              {docs.map((doc) => (
                                <LibraryRow
                                  key={doc.path || doc.name}
                                  name={doc.name}
                                  subtitle={doc.title}
                                  query={q}
                                  onSelect={() =>
                                    handleQuickAdd(doc.name, false)
                                  }
                                />
                              ))}
                            </Fragment>
                          ))}
                          {documentCount === 0 && (
                            <li className="list-none">
                              <EmptyRow
                                icon={Plus}
                                label="New document"
                                onClick={() => setDialogOpen(true)}
                              />
                            </li>
                          )}
                        </SidebarMenu>
                      )}
                    </section>
                  )}

                  {/* Themes, same shape. */}
                  {(themeCount > 0 || !q) && (
                    <section className="mt-3">
                      <SectionLabel
                        open={themesOpen}
                        onToggle={() => toggleGroup('themes')}
                        count={themeCount || undefined}
                        actions={
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <RailIconButton
                                aria-label="New theme"
                                onClick={() => setThemeDialogOpen(true)}
                              >
                                <Plus />
                              </RailIconButton>
                            </TooltipTrigger>
                            <TooltipContent side="bottom">
                              New theme
                            </TooltipContent>
                          </Tooltip>
                        }
                      >
                        Themes
                      </SectionLabel>
                      {themesOpen && (
                        <SidebarMenu className="gap-0.5">
                          {visibleThemes.map((doc) => (
                            <Fragment key={doc.name}>
                              <DocumentMenuItemMemoized
                                document={doc}
                                query={q}
                              />
                              {!q && activeTab === doc.name && <OutlinePanel />}
                            </Fragment>
                          ))}
                          {themeLocations.map(([location, items]) => (
                            <Fragment key={location}>
                              {themeLocations.length > 1 && (
                                <LocationDivider location={location} />
                              )}
                              {items.map((theme) => (
                                <LibraryRow
                                  key={theme.path || theme.name}
                                  name={theme.name}
                                  subtitle={theme.description}
                                  query={q}
                                  onSelect={() =>
                                    handleQuickAdd(theme.name, true)
                                  }
                                />
                              ))}
                            </Fragment>
                          ))}
                          {themeCount === 0 && (
                            <li className="list-none">
                              <EmptyRow
                                icon={Plus}
                                label="New theme"
                                onClick={() => setThemeDialogOpen(true)}
                              />
                            </li>
                          )}
                        </SidebarMenu>
                      )}
                    </section>
                  )}

                  {/* Not a file list, so it sits below the hairline. */}
                  <PluginsSection
                    plugins={libraryPlugins}
                    query={q}
                    open={isSectionOpen('plugins')}
                    onToggleSection={() => toggleGroup('plugins')}
                    onShowPluginDetails={(name) => {
                      setPluginSelectorFocusedPlugin(name);
                      setPluginSelectorOpen(true);
                    }}
                    isPluginSelected={isPluginSelected}
                    onTogglePlugin={togglePlugin}
                    isApplyingPlugins={isApplyingPlugins}
                    selectedPluginCount={selectedPlugins.size}
                  />
                </>
              )}
            </SidebarContent>
          </>
        )}

        <SidebarFooter
          className={cn('border-sidebar-border/70 gap-0 border-t p-1.5', fade)}
        >
          <div
            className={cn(
              'flex items-center',
              isCollapsed ? 'justify-center' : 'justify-start'
            )}
          >
            {/* The stock toggle is 36px with the card-plane hover fill; in a
                rail whose tallest row is 28px and whose every other hover is
                `sidebar-accent`, both read as foreign. */}
            <ButtonModeToggle className="size-7 rounded-sm text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground [&_svg]:size-3.5" />
          </div>
        </SidebarFooter>
      </Sidebar>

      {/* Creation dialogs are controlled rather than trigger-bound so the same
          dialog serves the expanded rail, the collapsed rail and the empty
          states. */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[525px]">
          <DocumentFormDialogContentMemoized
            mode="create"
            shouldReset={!dialogOpen}
            postSubmit={closeDialog}
            discoveredDocuments={discoveryData?.documents || []}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={themeDialogOpen} onOpenChange={setThemeDialogOpen}>
        <DialogContent className="sm:max-w-[525px]">
          <DocumentFormDialogContentMemoized
            mode="create"
            shouldReset={!themeDialogOpen}
            postSubmit={closeThemeDialog}
            discoveredThemes={discoveryData?.themes || []}
            isTheme={true}
          />
        </DialogContent>
      </Dialog>

      <Dialog
        open={pluginSelectorOpen}
        onOpenChange={(open) => {
          setPluginSelectorOpen(open);
          if (!open) setPluginSelectorFocusedPlugin(null);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-5xl">
          <PluginSelector
            plugins={discoveryData?.plugins || []}
            initialFocusedPlugin={pluginSelectorFocusedPlugin}
          />
        </DialogContent>
      </Dialog>

      <CompareDocumentsDialog
        open={compareDialogOpen}
        onOpenChange={setCompareDialogOpen}
      />
    </>
  );
}

// Export memoized version of DocumentSidebar component
export const DocumentSidebar = memo(DocumentSidebarComponent);
