import { useCallback, useState, useMemo, memo, useEffect, useRef } from 'react';
import {
  FilePlusIcon,
  PaletteIcon,
  Plus,
  Sparkles,
  Search,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { DocumentFormDialogContentMemoized } from './document-form-dialog-content';
import { DocumentMenuItemMemoized } from './document-menu-item';
import { PluginSelector } from './plugin-selector';
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
} from '../ui/sidebar';
import { useDocumentsStore } from '../../store/documents-store-provider';
import { useThemesStore } from '../../store/themes-store-provider';
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

interface DocumentSidebarProps {
  discoveryData: DiscoveryResult | null;
  onToggleSidebar?: () => void;
  isCollapsed?: boolean;
}

function DocumentSidebarComponent({
  discoveryData,
  onToggleSidebar,
  isCollapsed = false,
}: DocumentSidebarProps) {
  const { documents, documentTypes } = useDocumentsStore(
    useShallow((state) => ({
      documents: state.documents,
      documentTypes: state.documentTypes,
    }))
  );
  const updateTheme = useThemesStore((state) => state.updateTheme);
  const [dialogOpen, setDialogOpen] = useState<boolean>(false);
  const [themeDialogOpen, setThemeDialogOpen] = useState<boolean>(false);
  const [pluginSelectorOpen, setPluginSelectorOpen] = useState<boolean>(false);
  const [schemaDialogOpen, setSchemaDialogOpen] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    new Set(['current-docs', 'current-themes'])
  );

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
              if (component.name === 'report' && component.props?.theme) {
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

  // Sync only changed theme documents to the themes store
  useEffect(() => {
    const prevThemeDocs = prevThemeDocsRef.current;
    const currentThemeDocs = new Map<string, string>();

    // Build current themes map and detect changes
    themeDocuments.forEach((themeDoc) => {
      currentThemeDocs.set(themeDoc.name, themeDoc.text);

      // Check if this theme is new or has changed
      const prevContent = prevThemeDocs.get(themeDoc.name);
      if (prevContent !== themeDoc.text) {
        // Only sync themes that have actually changed
        updateTheme(themeDoc.name, themeDoc.text);
      }
    });

    // Update the ref for next comparison
    prevThemeDocsRef.current = currentThemeDocs;
  }, [themeDocuments, updateTheme]);

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

  return (
    // In-panel sidebar; includes global tools previously in header
    <>
      <Sidebar
        collapsible="none"
        style={{ ['--sidebar-width' as any]: '16rem' }}
      >
        <SidebarHeader>
          <div
            className={cn(
              'flex items-center',
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
        <SidebarContent className="h-full">
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
                      disabled={
                        !discoveryData || discoveryData.documents.length === 0
                      }
                    >
                      <Plus className="size-4" />
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
          </SidebarGroup>

          {/* Active Themes Section */}
          <SidebarGroup className="mt-4">
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
              {discoveryData && discoveryData.themes.length > 0 && (
                <Dialog
                  open={themeDialogOpen}
                  onOpenChange={setThemeDialogOpen}
                >
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
                        <Plus className="size-4" />
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
              )}
            </SidebarGroupLabel>
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
          </SidebarGroup>

          {/* Plugins moved under Discovered Resources */}

          {/* Discovered Resources Section */}
          {discoveryData &&
            (discoveryData.documents.length > 0 ||
              discoveryData.themes.length > 0) && (
            <SidebarGroup className="mt-6 border-t pt-4">
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
                            <div className="pl-6 space-y-0.5">
                              {docs.map((doc, idx) => (
                                <div
                                  key={idx}
                                  className="text-xs py-0.5 text-muted-foreground"
                                >
                                  <div className="font-medium">
                                    {doc.name}
                                  </div>
                                  {doc.title && (
                                    <div className="text-[10px] opacity-70">
                                      {doc.title}
                                    </div>
                                  )}
                                </div>
                              ))}
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
                            <div className="pl-6 space-y-0.5">
                              {themes.map((theme, idx) => (
                                <div
                                  key={idx}
                                  className="text-xs py-0.5 text-muted-foreground"
                                >
                                  <div className="font-medium">
                                    {theme.name}
                                  </div>
                                  {theme.description && (
                                    <div className="text-[10px] opacity-70">
                                      {theme.description}
                                    </div>
                                  )}
                                </div>
                              ))}
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
                          Plugins ({discoveryData.plugins.length})
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="pl-6 space-y-0.5">
                          {discoveryData.plugins.map((p, idx) => (
                            <div
                              key={idx}
                              className="text-xs py-0.5 text-muted-foreground"
                            >
                              <div className="font-medium">{p.name}</div>
                              {p.description && (
                                <div className="text-[10px] opacity-70">
                                  {p.description}
                                </div>
                              )}
                            </div>
                          ))}
                          <div className="flex items-center justify-end pr-3 pt-1">
                            <Button
                              className="h-6 px-2 text-xs"
                              variant="ghost"
                              title="Open plugin manager"
                              onClick={() => setPluginSelectorOpen(true)}
                            >
                                Manage plugins
                            </Button>
                          </div>
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
              'flex w-full items-center',
              isCollapsed ? 'justify-center' : 'justify-end pr-2'
            )}
          >
            <ButtonModeToggle />
          </div>
        </SidebarFooter>

        {/* Plugin Selector Dialog */}
        <Dialog open={pluginSelectorOpen} onOpenChange={setPluginSelectorOpen}>
          <DialogContent className="sm:max-w-5xl max-h-[85vh] overflow-hidden">
            <PluginSelector
              plugins={discoveryData?.plugins || []}
              onClose={() => setPluginSelectorOpen(false)}
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
