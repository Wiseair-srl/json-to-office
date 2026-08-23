import { useMemo } from 'react';
import { Info, Plus } from 'lucide-react';
import { Switch } from '../ui/switch';
import {
  HighlightedText,
  RailIconButton,
  SectionLabel,
} from './sidebar-shared';
import { cn } from '../../lib/utils';
import type { PluginMetadata } from '../../hooks/useDiscovery';

/**
 * The on-disk half of the rail.
 *
 * These rows no longer live in a section of their own. A file is a file: the
 * project's documents sit in the Documents list under the ones already open,
 * its themes under the open themes. The rail used to render both — the same
 * name twice, once as an open row and once as a library row tagged "Open" —
 * which asked the reader to hold two models of the same file.
 *
 * What is left here is the row itself and the one section that genuinely is
 * not a file list: plugins.
 */

const LOCATION_LABELS: Record<string, string> = {
  current: 'Current directory',
  downstream: 'Project',
};

/** Rendered only when a kind actually spans more than one location. */
export function LocationDivider({ location }: { location: string }) {
  return (
    <li className="list-none px-2 pt-2 pb-0.5 text-[10px] tracking-[0.08em] text-sidebar-foreground/65 uppercase">
      {LOCATION_LABELS[location] ?? location}
    </li>
  );
}

/**
 * A file on disk that is not open yet. Quieter than an open row and one click
 * from becoming one, so the `+` is the whole affordance — no icon, no badge,
 * nothing competing with the rows above it.
 */
export function LibraryRow({
  name,
  subtitle,
  query,
  onSelect,
}: {
  name: string;
  subtitle?: string;
  query: string;
  onSelect: () => void;
}) {
  return (
    <li className="list-none">
      <button
        type="button"
        onClick={onSelect}
        title={subtitle ? `${name} — ${subtitle}` : name}
        aria-label={`Add ${name} to workspace`}
        className={cn(
          'group/row flex h-7 w-full cursor-pointer items-center gap-2 rounded-sm pr-1 pl-2',
          'text-[13px] text-sidebar-foreground/70 transition-colors',
          'hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
          'focus-visible:ring-sidebar-ring focus-visible:ring-1 focus-visible:outline-none'
        )}
      >
        <span className="min-w-0 flex-1 truncate text-left">
          <HighlightedText text={name} query={query} />
        </span>
        <Plus
          aria-hidden
          className="size-3.5 shrink-0 text-sidebar-foreground/45 opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-visible/row:opacity-100"
        />
      </button>
    </li>
  );
}

/**
 * Plugins are a per-run setting, not a file, so they sit last and start
 * folded: `2/7` in the eyebrow is the whole story until you need the switches.
 */
export function PluginsSection({
  plugins,
  query,
  open,
  onToggleSection,
  onShowPluginDetails,
  isPluginSelected,
  onTogglePlugin,
  isApplyingPlugins,
  selectedPluginCount,
}: {
  plugins: PluginMetadata[];
  query: string;
  open: boolean;
  onToggleSection: () => void;
  onShowPluginDetails: (name: string) => void;
  isPluginSelected: (name: string) => boolean;
  onTogglePlugin: (plugin: PluginMetadata) => void;
  isApplyingPlugins: boolean;
  selectedPluginCount: number;
}) {
  if (plugins.length === 0) return null;

  return (
    <section className="border-sidebar-border/70 mt-3 border-t pt-2">
      <SectionLabel
        open={open}
        onToggle={onToggleSection}
        count={`${selectedPluginCount}/${plugins.length}`}
      >
        Plugins
      </SectionLabel>
      {open && (
        <div className="flex flex-col gap-0.5">
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
        </div>
      )}
    </section>
  );
}

/**
 * Splits a kind's on-disk files by where they were discovered, keeping
 * `current` ahead of `downstream` so the nearest files read first. The divider
 * only earns its row when a kind spans both.
 */
export function useLocationGroups<T extends { location: string }>(
  items: T[]
): Array<[string, T[]]> {
  return useMemo(() => {
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
  }, [items]);
}
