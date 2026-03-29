import { useState, useMemo, useEffect } from 'react';
import { PluginMetadata } from '../../hooks/useDiscovery';
import { copyPluginExample } from '../../utils/plugin-utils';
import { DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { ScrollArea } from '../ui/scroll-area';
import { Switch } from '../ui/switch';
import {
  Sparkles,
  Copy,
  MapPin,
  Package,
  FileText,
  CheckCircle,
  FolderTree,
  Braces,
  BookOpen,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { SchemaViewer } from './schema-viewer';
import { usePluginsStore } from '../../store/plugins-store';

interface PluginSelectorProps {
  plugins: PluginMetadata[];
  initialFocusedPlugin?: string | null;
}

export function PluginSelector({
  plugins,
  initialFocusedPlugin,
}: PluginSelectorProps) {
  const togglePlugin = usePluginsStore((state) => state.togglePlugin);
  const isPluginSelected = usePluginsStore((state) => state.isPluginSelected);
  const selectedPlugins = usePluginsStore((state) => state.selectedPlugins);
  const isApplyingPlugins = usePluginsStore((state) => state.isApplyingPlugins);

  const [activePlugin, setActivePlugin] = useState<PluginMetadata | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [detailSection, setDetailSection] = useState<
    'properties' | 'schema' | 'examples'
  >('properties');

  // Auto-select first plugin or initialFocusedPlugin
  useEffect(() => {
    if (initialFocusedPlugin) {
      const plugin = plugins.find((p) => p.name === initialFocusedPlugin);
      if (plugin) {
        setActivePlugin(plugin);
        return;
      }
    }
    if (plugins.length > 0 && !activePlugin) {
      setActivePlugin(plugins[0]);
    }
  }, [initialFocusedPlugin, plugins]);

  const groupedPlugins = useMemo(() => {
    const groups: Record<string, PluginMetadata[]> = {
      current: [],
      downstream: [],
      upstream: [],
    };
    plugins.forEach((plugin) => {
      if (groups[plugin.location]) {
        groups[plugin.location].push(plugin);
      }
    });
    return groups;
  }, [plugins]);

  const copyExample = async (example: any, index: number) => {
    if (!activePlugin) return;
    await copyPluginExample(activePlugin.name, example.props);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const getLocationLabel = (location: string) => {
    switch (location) {
      case 'current':
        return 'Current Directory';
      case 'downstream':
        return 'Project';
      case 'upstream':
        return 'Parent Directories';
      default:
        return location;
    }
  };

  const getLocationIcon = (location: string) => {
    switch (location) {
      case 'current':
        return <MapPin className="size-3" />;
      case 'downstream':
        return <Package className="size-3" />;
      case 'upstream':
        return <FileText className="size-3" />;
      default:
        return null;
    }
  };

  const hasProperties =
    activePlugin?.schema?.properties &&
    Object.keys(activePlugin.schema.properties).length > 0;
  const hasSchema = activePlugin?.schema?.jsonSchema;
  const hasExamples =
    activePlugin?.examples && activePlugin.examples.length > 0;

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Sparkles className="size-5 text-amber-600 dark:text-amber-400" />
          Plugins
          <Badge variant="secondary" className="font-normal">
            {selectedPlugins.size} active
          </Badge>
        </DialogTitle>
        <DialogDescription>
          {plugins.length} plugin{plugins.length !== 1 ? 's' : ''} discovered in
          your project
        </DialogDescription>
      </DialogHeader>

      <div className="mt-3 flex gap-0 h-[600px] border rounded-lg overflow-hidden">
        {/* Left panel — plugin list */}
        <div className="w-[240px] flex-none border-r bg-muted/30">
          <ScrollArea className="h-full">
            <div className="p-2 space-y-3">
              {Object.entries(groupedPlugins).map(
                ([location, locationPlugins]) => {
                  if (locationPlugins.length === 0) return null;

                  return (
                    <div key={location}>
                      <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                        {getLocationIcon(location)}
                        {getLocationLabel(location)}
                      </div>
                      <div className="space-y-0.5">
                        {locationPlugins.map((plugin) => {
                          const isEnabled = isPluginSelected(plugin.name);
                          const isActive = activePlugin?.name === plugin.name;
                          return (
                            <button
                              key={plugin.name}
                              onClick={() => setActivePlugin(plugin)}
                              className={cn(
                                'w-full text-left px-2 py-1.5 rounded-md transition-colors cursor-pointer',
                                'flex items-center gap-2',
                                isActive
                                  ? 'bg-accent text-accent-foreground'
                                  : 'hover:bg-accent/50 text-foreground'
                              )}
                            >
                              <div
                                className={cn(
                                  'size-1.5 rounded-full flex-none transition-colors',
                                  isEnabled
                                    ? 'bg-amber-500 dark:bg-amber-400'
                                    : 'bg-muted-foreground/30'
                                )}
                              />
                              <span className="text-sm font-medium truncate flex-1">
                                {plugin.name}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                }
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Right panel — detail */}
        {activePlugin ? (
          <div className="flex-1 flex flex-col min-w-0">
            {/* Plugin header */}
            <div className="flex-none px-5 py-4 border-b bg-background">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2.5">
                    <h3 className="text-base font-semibold truncate">
                      {activePlugin.name}
                    </h3>
                    {activePlugin.version && (
                      <Badge
                        variant="outline"
                        className="font-mono text-[11px] flex-none"
                      >
                        v{activePlugin.version}
                      </Badge>
                    )}
                  </div>
                  {activePlugin.description && (
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                      {activePlugin.description}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-none pt-0.5">
                  <span className="text-xs text-muted-foreground">
                    {isPluginSelected(activePlugin.name) ? 'On' : 'Off'}
                  </span>
                  <Switch
                    checked={isPluginSelected(activePlugin.name)}
                    onCheckedChange={() => togglePlugin(activePlugin)}
                    disabled={isApplyingPlugins}
                    aria-label={`Toggle ${activePlugin.name}`}
                  />
                </div>
              </div>
              <div className="flex items-center gap-1.5 mt-2 text-xs text-muted-foreground">
                {getLocationIcon(activePlugin.location)}
                <span>{getLocationLabel(activePlugin.location)}</span>
                <span className="text-muted-foreground/60 mx-1">/</span>
                <span className="font-mono truncate">
                  {activePlugin.relativePath}
                </span>
              </div>
            </div>

            {/* Section nav */}
            <div className="flex-none px-5 pt-3 pb-0 flex gap-1 border-b bg-background">
              {hasProperties && (
                <button
                  onClick={() => setDetailSection('properties')}
                  className={cn(
                    'px-3 py-1.5 text-sm font-medium rounded-t-md border-b-2 transition-colors cursor-pointer',
                    detailSection === 'properties'
                      ? 'border-primary text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <Braces className="size-3.5" />
                    Properties
                  </span>
                </button>
              )}
              {hasSchema && (
                <button
                  onClick={() => setDetailSection('schema')}
                  className={cn(
                    'px-3 py-1.5 text-sm font-medium rounded-t-md border-b-2 transition-colors cursor-pointer',
                    detailSection === 'schema'
                      ? 'border-primary text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <FolderTree className="size-3.5" />
                    Schema
                  </span>
                </button>
              )}
              {hasExamples && (
                <button
                  onClick={() => setDetailSection('examples')}
                  className={cn(
                    'px-3 py-1.5 text-sm font-medium rounded-t-md border-b-2 transition-colors cursor-pointer',
                    detailSection === 'examples'
                      ? 'border-primary text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <BookOpen className="size-3.5" />
                    Examples
                    <Badge
                      variant="secondary"
                      className="text-[10px] px-1.5 py-0 h-4"
                    >
                      {activePlugin.examples!.length}
                    </Badge>
                  </span>
                </button>
              )}
            </div>

            {/* Section content */}
            <ScrollArea className="flex-1">
              <div className="p-5">
                {/* Properties section */}
                {detailSection === 'properties' && hasProperties && (
                  <div className="space-y-1">
                    {Object.entries(activePlugin.schema.properties!).map(
                      ([key, prop]: [string, any]) => (
                        <PropertyRow key={key} name={key} prop={prop} />
                      )
                    )}
                  </div>
                )}

                {/* Schema section */}
                {detailSection === 'schema' && hasSchema && (
                  <SchemaViewer
                    schema={activePlugin.schema.jsonSchema}
                    loading={false}
                    className="h-[420px]"
                  />
                )}

                {/* Examples section */}
                {detailSection === 'examples' &&
                  hasExamples &&
                  activePlugin.examples!.map((example, index) => (
                    <div
                      key={index}
                      className={cn(index > 0 && 'mt-4 pt-4 border-t')}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2 min-w-0">
                          {example.title && (
                            <span className="font-medium text-sm truncate">
                              {example.title}
                            </span>
                          )}
                          {!example.title && (
                            <span className="text-sm text-muted-foreground">
                              Example {index + 1}
                            </span>
                          )}
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs flex-none"
                          onClick={() => copyExample(example, index)}
                        >
                          {copiedIndex === index ? (
                            <>
                              <CheckCircle className="size-3 mr-1 text-green-600" />
                              Copied
                            </>
                          ) : (
                            <>
                              <Copy className="size-3 mr-1" />
                              Copy
                            </>
                          )}
                        </Button>
                      </div>
                      {example.description && (
                        <p className="text-xs text-muted-foreground mb-2">
                          {example.description}
                        </p>
                      )}
                      <pre className="p-3 bg-muted rounded-md overflow-x-auto text-xs font-mono leading-relaxed">
                        {JSON.stringify(example.props, null, 2)}
                      </pre>
                    </div>
                  ))}

                {/* Empty state when no sections available */}
                {!hasProperties && !hasSchema && !hasExamples && (
                  <div className="text-center py-12 text-muted-foreground">
                    <Braces className="size-10 mx-auto mb-3 opacity-20" />
                    <p className="text-sm">
                      No schema or examples available for this plugin
                    </p>
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <p className="text-sm">Select a plugin to view details</p>
          </div>
        )}
      </div>
    </>
  );
}

/** Compact property row for the properties section */
function PropertyRow({ name, prop }: { name: string; prop: any }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails =
    prop.description ||
    prop.enum ||
    prop.default !== undefined ||
    prop.items ||
    prop.properties;

  const typeLabel =
    prop.type || (prop.enum ? 'enum' : prop.oneOf ? 'oneOf' : '—');

  return (
    <div className="rounded-md border">
      <button
        onClick={() => hasDetails && setExpanded(!expanded)}
        className={cn(
          'w-full text-left flex items-center gap-2 px-3 py-2 text-sm',
          hasDetails && 'cursor-pointer hover:bg-muted/50'
        )}
      >
        {hasDetails ? (
          expanded ? (
            <ChevronDown className="size-3 text-muted-foreground flex-none" />
          ) : (
            <ChevronRight className="size-3 text-muted-foreground flex-none" />
          )
        ) : (
          <span className="size-3 flex-none" />
        )}
        <span className="font-mono font-medium text-xs">{name}</span>
        <Badge
          variant="outline"
          className="text-[10px] px-1.5 py-0 h-4 flex-none"
        >
          {typeLabel}
        </Badge>
        {prop.optional === false && (
          <span className="text-[10px] text-red-500 font-medium flex-none">
            required
          </span>
        )}
        <span className="flex-1" />
        {prop.default !== undefined && (
          <span className="text-[10px] font-mono text-muted-foreground flex-none">
            = {JSON.stringify(prop.default)}
          </span>
        )}
      </button>
      {expanded && hasDetails && (
        <div className="px-3 pb-2 pt-0 ml-5 text-xs space-y-1 text-muted-foreground">
          {prop.description && <p>{prop.description}</p>}
          {prop.enum && (
            <p>
              <span className="font-medium text-foreground">Values: </span>
              {prop.enum.map((v: any, i: number) => (
                <span key={i}>
                  {i > 0 && ', '}
                  <code className="bg-muted px-1 rounded">
                    {JSON.stringify(v)}
                  </code>
                </span>
              ))}
            </p>
          )}
          {prop.items?.type && (
            <p>
              <span className="font-medium text-foreground">Items: </span>
              {prop.items.type}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
