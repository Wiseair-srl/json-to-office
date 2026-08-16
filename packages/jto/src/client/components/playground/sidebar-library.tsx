import React, { useMemo } from 'react';
import { ChevronRight, Info, Plus } from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../ui/collapsible';
import { Switch } from '../ui/switch';
import { HighlightedText, RailIconButton } from './sidebar-shared';
import { cn } from '../../lib/utils';
import type {
  DocumentMetadata,
  PluginMetadata,
  ThemeMetadata,
} from '../../hooks/useDiscovery';

/**
 * The project library: everything discovered on disk that is not open yet.
 *
 * The old rail nested this two levels deep (Discovered Resources → Project
 * Documents → the file), which spent ~40px of a 256px rail on chrome. These
 * are top-level sections now, one per kind, with a single tree guide for depth.
 */

const LOCATION_LABELS: Record<string, string> = {
  current: 'Current directory',
  downstream: 'Project',
};

function LibrarySection({
  id,
  label,
  count,
  open,
  onToggle,
  children,
}: {
  id: string;
  label: string;
  count: React.ReactNode;
  open: boolean;
  onToggle: (id: string) => void;
  children: React.ReactNode;
}) {
  return (
    <Collapsible open={open}>
      <CollapsibleTrigger
        onClick={() => onToggle(id)}
        className={cn(
          'flex h-7 w-full cursor-pointer items-center gap-1.5 rounded-sm px-1',
          'text-sidebar-foreground/70 transition-colors',
          'hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
          'focus-visible:ring-sidebar-ring focus-visible:ring-1 focus-visible:outline-none'
        )}
      >
        <ChevronRight
          className={cn(
            'size-3 shrink-0 transition-transform duration-150 ease-out',
            open && 'rotate-90'
          )}
        />
        <span className="text-[11px] font-medium tracking-[0.08em] uppercase">
          {label}
        </span>
        <span className="ml-auto text-[11px] font-normal tabular-nums text-sidebar-foreground/65">
          {count}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-sidebar-border/70 mt-0.5 ml-[13px] border-l pl-1">
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Rendered only when a section actually spans more than one location. */
function LocationDivider({ location }: { location: string }) {
  return (
    <div className="px-2 pt-2 pb-0.5 text-[10px] tracking-[0.08em] text-sidebar-foreground/65 uppercase">
      {LOCATION_LABELS[location] ?? location}
    </div>
  );
}

/**
 * A file on disk. Already-open files stay in the list — hiding them makes the
 * library flicker as you work — but they read as inert and jump to the open
 * copy instead of re-adding it.
 */
function LibraryRow({
  name,
  subtitle,
  added,
  query,
  onSelect,
}: {
  name: string;
  subtitle?: string;
  added: boolean;
  query: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      title={subtitle ? `${name} — ${subtitle}` : name}
      aria-label={added ? `Open ${name}` : `Add ${name} to workspace`}
      className={cn(
        'group/row flex h-7 w-full cursor-pointer items-center gap-2 rounded-sm px-2',
        'text-[13px] transition-colors',
        'hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
        'focus-visible:ring-sidebar-ring focus-visible:ring-1 focus-visible:outline-none',
        'text-sidebar-foreground/70'
      )}
    >
      <span className="truncate">
        <HighlightedText text={name} query={query} />
      </span>
      {added ? (
        /* A tag, not a wash. Dimming the label to signal "already open" is the
           same move as disabling it — but these rows still work: they jump to
           the open copy. */
        <span className="ml-auto shrink-0 text-[10px] tracking-[0.06em] text-sidebar-foreground/65 uppercase">
          Open
        </span>
      ) : (
        <Plus
          aria-hidden
          className="ml-auto size-3.5 shrink-0 text-sidebar-foreground/45 opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-visible/row:opacity-100"
        />
      )}
    </button>
  );
}

export function SidebarLibrary({
  documents,
  themes,
  plugins,
  openNames,
  query,
  expandedGroups,
  onToggleGroup,
  onQuickAdd,
  onShowPluginDetails,
  isPluginSelected,
  onTogglePlugin,
  isApplyingPlugins,
  selectedPluginCount,
}: {
  documents: DocumentMetadata[];
  themes: ThemeMetadata[];
  plugins: PluginMetadata[];
  openNames: Set<string>;
  query: string;
  expandedGroups: Set<string>;
  onToggleGroup: (id: string) => void;
  onQuickAdd: (name: string, isTheme: boolean) => void;
  onShowPluginDetails: (name: string) => void;
  isPluginSelected: (name: string) => boolean;
  onTogglePlugin: (plugin: PluginMetadata) => void;
  isApplyingPlugins: boolean;
  selectedPluginCount: number;
}) {
  // A live filter that leaves its matches folded away is a filter that does
  // nothing, so a query forces every section with hits open.
  const isOpen = (id: string) => (query ? true : expandedGroups.has(id));

  const documentLocations = useMemo(
    () => groupByLocation(documents),
    [documents]
  );
  const themeLocations = useMemo(() => groupByLocation(themes), [themes]);

  const hasAnything =
    documents.length > 0 || themes.length > 0 || plugins.length > 0;
  if (!hasAnything) return null;

  return (
    <div className="flex flex-col gap-0.5">
      {documents.length > 0 && (
        <LibrarySection
          id="library-documents"
          label="Project documents"
          count={documents.length}
          open={isOpen('library-documents')}
          onToggle={onToggleGroup}
        >
          {documentLocations.map(([location, docs]) => (
            <React.Fragment key={location}>
              {documentLocations.length > 1 && (
                <LocationDivider location={location} />
              )}
              {docs.map((doc) => (
                <LibraryRow
                  key={doc.path || doc.name}
                  name={doc.name}
                  subtitle={doc.title}
                  added={openNames.has(doc.name)}
                  query={query}
                  onSelect={() => onQuickAdd(doc.name, false)}
                />
              ))}
            </React.Fragment>
          ))}
        </LibrarySection>
      )}

      {themes.length > 0 && (
        <LibrarySection
          id="library-themes"
          label="Project themes"
          count={themes.length}
          open={isOpen('library-themes')}
          onToggle={onToggleGroup}
        >
          {themeLocations.map(([location, items]) => (
            <React.Fragment key={location}>
              {themeLocations.length > 1 && (
                <LocationDivider location={location} />
              )}
              {items.map((theme) => (
                <LibraryRow
                  key={theme.path || theme.name}
                  name={theme.name}
                  subtitle={theme.description}
                  added={openNames.has(theme.name)}
                  query={query}
                  onSelect={() => onQuickAdd(theme.name, true)}
                />
              ))}
            </React.Fragment>
          ))}
        </LibrarySection>
      )}

      {plugins.length > 0 && (
        <LibrarySection
          id="library-plugins"
          label="Plugins"
          count={`${selectedPluginCount}/${plugins.length}`}
          open={isOpen('library-plugins')}
          onToggle={onToggleGroup}
        >
          {plugins.map((plugin) => {
            const active = isPluginSelected(plugin.name);
            // Same identity the row key uses: two plugins discovered in
            // different locations can share a name, and a duplicate id would
            // point every `htmlFor` at the first switch.
            const switchId = `plugin-switch-${plugin.filePath || plugin.name}`;
            return (
              <div
                key={plugin.filePath || plugin.name}
                title={
                  plugin.description
                    ? `${plugin.name} — ${plugin.description}`
                    : plugin.name
                }
                className={cn(
                  'group/row flex h-7 w-full items-center gap-1 rounded-sm pr-1 pl-2',
                  'transition-colors hover:bg-sidebar-accent/60'
                )}
              >
                {/* The name labels the switch, so the toggle target is the
                    whole 28px row rather than an 18px track — a switch alone
                    is under the 24px minimum and its neighbours are too close
                    to qualify for the spacing exception. */}
                <label
                  htmlFor={switchId}
                  className={cn(
                    'flex h-7 min-w-0 flex-1 cursor-pointer items-center text-[13px]',
                    active
                      ? 'text-sidebar-foreground'
                      : 'text-sidebar-foreground/70'
                  )}
                >
                  <span className="truncate">
                    <HighlightedText text={plugin.name} query={query} />
                  </span>
                </label>
                <RailIconButton
                  aria-label={`Details for ${plugin.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onShowPluginDetails(plugin.name);
                  }}
                  className="opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100"
                >
                  <Info />
                </RailIconButton>
                <Switch
                  id={switchId}
                  checked={active}
                  onCheckedChange={() => onTogglePlugin(plugin)}
                  disabled={isApplyingPlugins}
                  className="shrink-0"
                  aria-label={`Toggle ${plugin.name} plugin`}
                />
              </div>
            );
          })}
        </LibrarySection>
      )}
    </div>
  );
}

/** Keeps `current` ahead of `downstream` so the nearest files read first. */
function groupByLocation<T extends { location: string }>(
  items: T[]
): Array<[string, T[]]> {
  const order = ['current', 'downstream'];
  const groups = new Map<string, T[]>();
  items.forEach((item) => {
    const bucket = groups.get(item.location);
    if (bucket) bucket.push(item);
    else groups.set(item.location, [item]);
  });
  return [...groups.entries()].sort(
    ([a], [b]) => order.indexOf(a) - order.indexOf(b)
  );
}
