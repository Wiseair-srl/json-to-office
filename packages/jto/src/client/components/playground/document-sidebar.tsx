import {
  useCallback,
  useState,
  useMemo,
  memo,
  useEffect,
  useRef,
  useContext,
} from 'react';
import {
  FilePlusIcon,
  PaletteIcon,
  Plus,
  Sparkles,
  Search,
  PanelLeftClose,
  PanelLeftOpen,
  Info,
} from 'lucide-react';
import { DocumentFormDialogContentMemoized } from './document-form-dialog-content';
import { DocumentMenuItemMemoized } from './document-menu-item';
import { PluginSelector } from './plugin-selector';
import { Switch } from '../ui/switch';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogTrigger } from '../ui/dialog';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarFooter,
  SidebarMenu,
  SidebarSeparator,
} from '../ui/sidebar';
import { useDocumentsStore } from '../../store/documents-store-provider';
import {
  useThemesStore,
  ThemesStoreContext,
} from '../../store/themes-store-provider';
import type {
  DiscoveryResult,
  DocumentMetadata,
  ThemeMetadata,
} from '../../hooks/useDiscovery';
import { useShallow } from 'zustand/react/shallow';
import { getThemeName } from '../../lib/theme-validation';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../ui/collapsible';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';
import { ButtonModeToggle } from '../mode-toggle';
import { SchemaDialog } from './schema-dialog';
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

function DocumentSidebarComponent({
  discoveryData,
  onToggleSidebar,
  isCollapsed = false,
  isAnimating = false,
}: DocumentSidebarProps) {
  const { documents, documentTypes, createDocument, openDocument } =
    useDocumentsStore(
      useShallow((state) => ({
        documents: state.documents,
        documentTypes: state.documentTypes,
        createDocument: state.createDocument,
        openDocument: state.openDocument,
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
  const [schemaDialogOpen, setSchemaDialogOpen] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    new Set(['current-docs', 'current-themes'])
  );
  const { toast } = useToast();

  // Separate documents and themes
  const reportDocuments = documents.filter(
    (doc) => documentTypes[doc.name] !== 'application/json+theme'
  );
  const themeDocuments = documents.filter(
    (doc) => documentTypes[doc.name] === 'application/json+theme'
  );

  // Group discovered documents and themes by location
  const groupedDiscoveredDocuments = useMemo(() => {
    if (!discoveryData) return { current: [], downstream: [] };

    const groups: Record<string, DocumentMetadata[]> = {
      current: [],
      downstream: [],
    };

    discoveryData.documents.forEach((doc) => {
      if (groups[doc.location]) {
        groups[doc.location].push(doc);
      }
    });

    return groups;
  }, [discoveryData]);

  const groupedDiscoveredThemes = useMemo(() => {
    if (!discoveryData) return { current: [], downstream: [] };

    const groups: Record<string, ThemeMetadata[]> = {
      current: [],
      downstream: [],
    };

    discoveryData.themes.forEach((theme) => {
      if (groups[theme.location]) {
        groups[theme.location].push(theme);
      }
    });

    return groups;
  }, [discoveryData]);

  // Extract theme names from documents
  const themesInUse = useMemo(() => {
    const themes = new Set<string>();
    reportDocuments.forEach((doc) => {
      try {
        const parsed = JSON.parse(doc.text);
        // Look for theme in the report component props
        if (parsed.children && Array.isArray(parsed.children)) {
          parsed.children.forEach(
            (component: { name?: string; props?: { theme?: string } }) => {
              if (component.name === 'docx' && component.props?.theme) {
                themes.add(component.props.theme);
              }
            }
          );
        }
      } catch {
        // Ignore parse errors
      }
    });
    return themes;
  }, [reportDocuments]);

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

  const toggleGroup = (groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  const activeTab = useDocumentsStore((state) => state.activeTab);
  const activeDocumentType =
    activeTab && documentTypes[activeTab] === 'application/json+theme'
      ? 'theme'
      : 'document';

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
        createDocument(name, JSON.stringify(parsed, null, 2));
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

  return (
    // In-panel sidebar; includes global tools previously in header
    <>
      <Sidebar
        collapsible="none"
        style={{ ['--sidebar-width' as any]: isCollapsed ? '2.5rem' : '16rem' }}
      >
        <SidebarHeader>
          <div
            className={cn(
              'flex items-center transition-opacity duration-[120ms] ease-in-out',
              isAnimating ? 'opacity-0' : 'opacity-100',
              isCollapsed ? 'justify-center' : 'justify-between'
            )}
          >
            {isCollapsed ? (
              <Button
                variant="ghost"
                size="icon"
                title="Expand sidebar"
                onClick={onToggleSidebar}
              >
                <PanelLeftOpen className="h-4 w-4" />
              </Button>
            ) : (
              <>
                <a href="/" className="flex items-center pl-2">
                  <img
                    src={logoSrc}
                    alt="WiseAir logo"
                    className="h-5 w-auto max-w-[120px] shrink-0"
                  />
                </a>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Collapse sidebar"
                    onClick={onToggleSidebar}
                  >
                    <PanelLeftClose className="h-4 w-4" />
                  </Button>
                </div>
              </>
            )}
          </div>
        </SidebarHeader>
        <SidebarContent
          className={cn(
            'h-full transition-opacity duration-[120ms] ease-in-out',
            isAnimating ? 'opacity-0' : 'opacity-100'
          )}
        >
          {/* Active Documents Section */}
          <SidebarGroup>
            <SidebarGroupLabel
              className={cn(
                'flex items-center',
                isCollapsed ? 'justify-center' : 'justify-between'
              )}
            >
              <div className="flex items-center gap-2">
                {!isCollapsed && <FilePlusIcon className="size-3" />}
                {!isCollapsed && <span>Active Documents</span>}
              </div>
              <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogTrigger asChild>
                  <div
                    className={cn(
                      'flex',
                      isCollapsed ? 'w-full justify-center' : ''
                    )}
                  >
                    <Button
                      className={cn(
                        'h-6 w-6 p-0 flex-shrink-0',
                        isCollapsed && 'mx-auto'
                      )}
                      variant="ghost"
                      size="icon"
                      title="New Document"
                    >
                      {isCollapsed ? (
                        <FilePlusIcon className="size-4" />
                      ) : (
                        <Plus className="size-4" />
                      )}
                    </Button>
                  </div>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[525px]">
                  <DocumentFormDialogContentMemoized
                    mode="create"
                    shouldReset={!dialogOpen}
                    postSubmit={closeDialog}
                    discoveredDocuments={discoveryData?.documents || []}
                  />
                </DialogContent>
              </Dialog>
            </SidebarGroupLabel>
            {isCollapsed ? (
              /* Collapsed: show icon badges for each doc */
              <SidebarGroupContent>
                <div className="flex flex-col items-center gap-0.5 px-0.5">
                  {reportDocuments.map((doc) => {
                    const isActive = activeTab === doc.name;
                    return (
                      <Tooltip key={doc.name}>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => openDocument(doc.name)}
                            className={cn(
                              'relative w-7 h-7 rounded flex items-center justify-center text-[10px] font-bold transition-colors',
                              isActive
                                ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                            )}
                          >
                            {isActive && (
                              <span className="absolute left-0 top-1 bottom-1 w-0.5 rounded-full bg-green-500 dark:bg-green-400" />
                            )}
                            {doc.name.charAt(0).toUpperCase()}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="right">
                          <span className="text-xs">{doc.name}</span>
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                </div>
              </SidebarGroupContent>
            ) : (
              <SidebarGroupContent>
                <SidebarMenu>
                  {reportDocuments.length > 0 ? (
                    reportDocuments.map((doc, index) => (
                      <DocumentMenuItemMemoized
                        key={`doc-${index}`}
                        document={doc}
                        compact={isCollapsed}
                      />
                    ))
                  ) : (
                    <div className="px-3 py-2 text-xs text-muted-foreground">
                      No active documents. Click + to create one.
                    </div>
                  )}
                </SidebarMenu>
              </SidebarGroupContent>
            )}
          </SidebarGroup>

          {/* Separator between documents and themes */}
          <SidebarSeparator />

          {/* Active Themes Section */}
          <SidebarGroup>
            <SidebarGroupLabel
              className={cn(
                'flex items-center',
                isCollapsed ? 'justify-center' : 'justify-between'
              )}
            >
              <div className="flex items-center gap-2">
                {!isCollapsed && (
                  <PaletteIcon className="size-3 text-purple-600 dark:text-purple-400" />
                )}
                {!isCollapsed && <span>Active Themes</span>}
              </div>
              <Dialog open={themeDialogOpen} onOpenChange={setThemeDialogOpen}>
                <DialogTrigger asChild>
                  <div
                    className={cn(
                      'flex',
                      isCollapsed ? 'w-full justify-center' : ''
                    )}
                  >
                    <Button
                      className={cn(
                        'h-6 w-6 p-0 flex-shrink-0',
                        isCollapsed && 'mx-auto'
                      )}
                      variant="ghost"
                      size="icon"
                      title="New Theme"
                    >
                      {isCollapsed ? (
                        <PaletteIcon className="size-4" />
                      ) : (
                        <Plus className="size-4" />
                      )}
                    </Button>
                  </div>
                </DialogTrigger>
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
            </SidebarGroupLabel>
            {isCollapsed ? (
              /* Collapsed: show icon badges for each theme */
              <SidebarGroupContent>
                <div className="flex flex-col items-center gap-0.5 px-0.5">
                  {themeDocuments.map((doc) => {
                    const isActive = activeTab === doc.name;
                    let themeName: string | null = null;
                    try {
                      const parsed = JSON.parse(doc.text);
                      themeName = getThemeName(parsed);
                    } catch {}
                    const isInUse = themeName
                      ? themesInUse.has(themeName)
                      : false;

                    return (
                      <Tooltip key={doc.name}>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => openDocument(doc.name)}
                            className={cn(
                              'relative w-7 h-7 rounded flex items-center justify-center text-[10px] font-bold transition-colors',
                              isActive
                                ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300'
                                : isInUse
                                  ? 'bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400'
                                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                            )}
                          >
                            {isActive && (
                              <span className="absolute left-0 top-1 bottom-1 w-0.5 rounded-full bg-purple-500 dark:bg-purple-400" />
                            )}
                            <PaletteIcon className="size-3" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="right">
                          <div className="text-xs">
                            {doc.name}
                            {isInUse && (
                              <div className="opacity-70">In use</div>
                            )}
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                </div>
              </SidebarGroupContent>
            ) : (
              <SidebarGroupContent>
                <SidebarMenu>
                  {themeDocuments.length > 0 ? (
                    themeDocuments.map((doc, index) => {
                      // Get the actual theme name from the parsed content
                      let themeName: string | null = null;
                      try {
                        const parsed = JSON.parse(doc.text);
                        themeName = getThemeName(parsed);
                      } catch {
                        // If parsing fails, theme is not valid
                      }

                      // Check if this theme name is in use
                      const isInUse = themeName
                        ? themesInUse.has(themeName)
                        : false;
                      return (
                        <DocumentMenuItemMemoized
                          key={`theme-${index}`}
                          document={doc}
                          compact={isCollapsed}
                          indicator={isInUse ? 'in-use' : undefined}
                        />
                      );
                    })
                  ) : (
                    <div className="px-3 py-2 text-xs text-muted-foreground">
                      No active themes.{' '}
                      {discoveryData && discoveryData.themes.length > 0
                        ? 'Click + to add one.'
                        : 'No themes discovered in project.'}
                    </div>
                  )}
                </SidebarMenu>
              </SidebarGroupContent>
            )}
          </SidebarGroup>

          {/* Plugins moved under Discovered Resources */}

          {/* Discovered Resources Section */}
          {discoveryData &&
            (discoveryData.documents.length > 0 ||
              discoveryData.themes.length > 0) && (
              <SidebarGroup className="mt-2 border-t pt-4">
                <SidebarGroupLabel
                  className={cn(
                    'flex items-center mb-2',
                    isCollapsed ? 'justify-center' : 'gap-2'
                  )}
                >
                  {isCollapsed ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Search className="size-3" />
                      </TooltipTrigger>
                      <TooltipContent side="right">
                        <span className="text-xs">
                          Expand sidebar to show discovered resources
                        </span>
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <>
                      <Search className="size-3" />
                      <span>Discovered Resources</span>
                    </>
                  )}
                </SidebarGroupLabel>

                {!isCollapsed && (
                  <>
                    {/* Discovered Documents */}
                    {Object.entries(groupedDiscoveredDocuments).map(
                      ([location, docs]) => {
                        if (docs.length === 0) return null;
                        const groupId = `${location}-docs`;
                        const isExpanded = expandedGroups.has(groupId);

                        return (
                          <Collapsible key={groupId} open={isExpanded}>
                            <CollapsibleTrigger
                              className="flex items-center gap-1 px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer w-full"
                              onClick={() => toggleGroup(groupId)}
                            >
                              <ChevronDown
                                className={cn(
                                  'size-3 transition-transform',
                                  !isExpanded && '-rotate-90'
                                )}
                              />
                              <FilePlusIcon className="size-3" />
                              {location === 'current'
                                ? 'Current Directory'
                                : 'Project'}{' '}
                              Documents ({docs.length})
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                              <div className="pl-4 space-y-0.5">
                                {docs.map((doc, idx) => {
                                  const alreadyAdded = documents.some(
                                    (d) => d.name === doc.name
                                  );
                                  return (
                                    <button
                                      key={idx}
                                      onClick={() =>
                                        handleQuickAdd(doc.name, false)
                                      }
                                      className={cn(
                                        'w-full text-left py-1 px-2 rounded text-sm transition-colors',
                                        'border-l-2 border-blue-400/60 dark:border-blue-500/40',
                                        'hover:bg-accent hover:text-accent-foreground',
                                        alreadyAdded && 'opacity-50'
                                      )}
                                    >
                                      <div className="font-medium truncate">
                                        {doc.name}
                                      </div>
                                      {doc.title && (
                                        <div className="text-xs text-muted-foreground truncate">
                                          {doc.title}
                                        </div>
                                      )}
                                    </button>
                                  );
                                })}
                              </div>
                            </CollapsibleContent>
                          </Collapsible>
                        );
                      }
                    )}

                    {/* Discovered Themes */}
                    {Object.entries(groupedDiscoveredThemes).map(
                      ([location, themes]) => {
                        if (themes.length === 0) return null;
                        const groupId = `${location}-themes`;
                        const isExpanded = expandedGroups.has(groupId);

                        return (
                          <Collapsible key={groupId} open={isExpanded}>
                            <CollapsibleTrigger
                              className="flex items-center gap-1 px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer w-full"
                              onClick={() => toggleGroup(groupId)}
                            >
                              <ChevronDown
                                className={cn(
                                  'size-3 transition-transform',
                                  !isExpanded && '-rotate-90'
                                )}
                              />
                              <PaletteIcon className="size-3" />
                              {location === 'current'
                                ? 'Current Directory'
                                : 'Project'}{' '}
                              Themes ({themes.length})
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                              <div className="pl-4 space-y-0.5">
                                {themes.map((theme, idx) => {
                                  const alreadyAdded = documents.some(
                                    (d) => d.name === theme.name
                                  );
                                  return (
                                    <button
                                      key={idx}
                                      onClick={() =>
                                        handleQuickAdd(theme.name, true)
                                      }
                                      className={cn(
                                        'w-full text-left py-1 px-2 rounded text-sm transition-colors',
                                        'border-l-2 border-purple-400/60 dark:border-purple-500/40',
                                        'hover:bg-accent hover:text-accent-foreground',
                                        alreadyAdded && 'opacity-50'
                                      )}
                                    >
                                      <div className="font-medium truncate">
                                        {theme.name}
                                      </div>
                                      {theme.description && (
                                        <div className="text-xs text-muted-foreground truncate">
                                          {theme.description}
                                        </div>
                                      )}
                                    </button>
                                  );
                                })}
                              </div>
                            </CollapsibleContent>
                          </Collapsible>
                        );
                      }
                    )}

                    {/* Discovered Plugins */}
                    {discoveryData && discoveryData.plugins.length > 0 && (
                      <Collapsible open={expandedGroups.has('plugins')}>
                        <CollapsibleTrigger
                          className="flex items-center gap-1 px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer w-full"
                          onClick={() => toggleGroup('plugins')}
                        >
                          <ChevronDown
                            className={cn(
                              'size-3 transition-transform',
                              !expandedGroups.has('plugins') && '-rotate-90'
                            )}
                          />
                          <Sparkles className="size-3 text-amber-600 dark:text-amber-400" />
                          Plugins ({selectedPlugins.size}/
                          {discoveryData.plugins.length})
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="pl-4 space-y-0.5">
                            {discoveryData.plugins.map((p, idx) => {
                              const isActive = isPluginSelected(p.name);
                              return (
                                <div
                                  key={idx}
                                  className={cn(
                                    'py-1 px-2 text-sm border-l-2 flex items-center gap-2 group transition-colors',
                                    isActive
                                      ? 'border-amber-500 dark:border-amber-400 text-foreground'
                                      : 'border-amber-400/30 dark:border-amber-500/20 text-muted-foreground'
                                  )}
                                >
                                  <div className="flex-1 min-w-0">
                                    <div className="font-medium truncate">
                                      {p.name}
                                    </div>
                                    {p.description && (
                                      <div className="text-xs opacity-70 truncate">
                                        {p.description}
                                      </div>
                                    )}
                                  </div>
                                  <button
                                    className="flex-none size-5 flex items-center justify-center rounded-sm opacity-0 group-hover:opacity-100 hover:bg-accent transition-all cursor-pointer"
                                    title={`View details for ${p.name}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setPluginSelectorFocusedPlugin(p.name);
                                      setPluginSelectorOpen(true);
                                    }}
                                  >
                                    <Info className="size-3 text-muted-foreground" />
                                  </button>
                                  <Switch
                                    checked={isActive}
                                    onCheckedChange={() => togglePlugin(p)}
                                    disabled={isApplyingPlugins}
                                    className="flex-none scale-[0.8]"
                                    aria-label={`Toggle ${p.name} plugin`}
                                  />
                                </div>
                              );
                            })}
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    )}
                  </>
                )}
              </SidebarGroup>
            )}
        </SidebarContent>
        <SidebarFooter>
          <div
            className={cn(
              'flex w-full items-center transition-opacity duration-[120ms] ease-in-out',
              isAnimating ? 'opacity-0' : 'opacity-100',
              isCollapsed ? 'justify-center' : 'justify-end pr-2'
            )}
          >
            <ButtonModeToggle />
          </div>
        </SidebarFooter>

        {/* Plugin Selector Dialog */}
        <Dialog
          open={pluginSelectorOpen}
          onOpenChange={(open) => {
            setPluginSelectorOpen(open);
            if (!open) setPluginSelectorFocusedPlugin(null);
          }}
        >
          <DialogContent className="sm:max-w-5xl max-h-[85vh] overflow-hidden">
            <PluginSelector
              plugins={discoveryData?.plugins || []}
              initialFocusedPlugin={pluginSelectorFocusedPlugin}
            />
          </DialogContent>
        </Dialog>
      </Sidebar>
      {/* Schema Dialog */}
      <SchemaDialog
        open={schemaDialogOpen}
        onOpenChange={setSchemaDialogOpen}
        defaultTab={activeDocumentType === 'theme' ? 'theme' : 'document'}
      />
    </>
  );
}

// Export memoized version of DocumentSidebar component
export const DocumentSidebar = memo(DocumentSidebarComponent);
