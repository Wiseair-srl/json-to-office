import { useState, useMemo } from 'react';
import { PluginMetadata } from '../../hooks/useDiscovery';
import { copyPluginExample } from '../../utils/plugin-utils';
import { DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { ScrollArea } from '../ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import {
  Sparkles,
  Code,
  FileJson,
  Copy,
  ChevronRight,
  ChevronLeft,
  MapPin,
  Package,
  FileText,
  Eye,
  Info,
  CheckCircle,
  Check,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { SchemaViewer } from './schema-viewer';
import { usePluginsStore } from '../../store/plugins-store';

interface PluginSelectorProps {
  plugins: PluginMetadata[];
}

export function PluginSelector({ plugins }: PluginSelectorProps) {
  const togglePlugin = usePluginsStore((state) => state.togglePlugin);
  const isPluginSelected = usePluginsStore((state) => state.isPluginSelected);

  const [selectedPlugin, setSelectedPlugin] = useState<PluginMetadata | null>(
    null
  );
  const [currentView, setCurrentView] = useState<'list' | 'detail'>('list');
  const [activeTab, setActiveTab] = useState('overview');
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [selectedExample, setSelectedExample] = useState(0);
  const [exampleView, setExampleView] = useState<'list' | 'detail'>('list');

  const handlePluginSelect = (plugin: PluginMetadata) => {
    setSelectedPlugin(plugin);
    setCurrentView('detail');
  };

  const handleBackToList = () => {
    setCurrentView('list');
    setActiveTab('overview');
    setSelectedExample(0);
    setExampleView('list');
  };

  // Group plugins by location
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
    if (!selectedPlugin) return;
    await copyPluginExample(selectedPlugin.name, example.props);
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

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Sparkles className="size-5 text-amber-600 dark:text-amber-400" />
          Discovered Plugins
        </DialogTitle>
        <DialogDescription>
          {plugins.length} plugin{plugins.length !== 1 ? 's' : ''} discovered in
          your project.
        </DialogDescription>
      </DialogHeader>

      <div className="mt-4 flex-1 overflow-hidden">
        {/* List View */}
        {currentView === 'list' && (
          <ScrollArea className="h-[600px] pr-4">
            {Object.entries(groupedPlugins).map(
              ([location, locationPlugins]) => {
                if (locationPlugins.length === 0) return null;

                return (
                  <div key={location} className="mb-6">
                    <div className="flex items-center gap-2 mb-2 text-sm font-semibold text-muted-foreground">
                      {getLocationIcon(location)}
                      {getLocationLabel(location)}
                      <Badge variant="secondary" className="ml-auto">
                        {locationPlugins.length}
                      </Badge>
                    </div>

                    <div className="space-y-1">
                      {locationPlugins.map((plugin) => {
                        const isSelected = isPluginSelected(plugin.name);
                        return (
                          <div
                            key={plugin.name}
                            role="checkbox"
                            aria-checked={isSelected}
                            tabIndex={0}
                            onKeyDown={(e) => {
                              if (e.key === ' ' || e.key === 'Enter') {
                                e.preventDefault();
                                togglePlugin(plugin);
                              }
                            }}
                            onClick={() => togglePlugin(plugin)}
                            className={cn(
                              'flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors group',
                              isSelected
                                ? 'bg-primary/10 border-primary'
                                : 'hover:bg-accent/50'
                            )}
                          >
                            <div
                              className={cn(
                                'flex-none size-4 rounded border transition-colors flex items-center justify-center',
                                isSelected
                                  ? 'bg-primary border-primary'
                                  : 'border-muted-foreground/40'
                              )}
                            >
                              {isSelected && (
                                <Check className="size-3 text-primary-foreground" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-medium truncate">
                                  {plugin.name}
                                </span>
                                {plugin.version && (
                                  <span className="text-xs text-muted-foreground font-mono">
                                    v{plugin.version}
                                  </span>
                                )}
                              </div>
                              {plugin.description && (
                                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                                  {plugin.description}
                                </p>
                              )}
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="flex-none size-7 opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={(e) => {
                                e.stopPropagation();
                                handlePluginSelect(plugin);
                              }}
                            >
                              <ChevronRight className="size-4 text-muted-foreground" />
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              }
            )}
          </ScrollArea>
        )}

        {/* Detail View with Tabs */}
        {currentView === 'detail' && selectedPlugin && (
          <div className="flex flex-col h-full">
            {/* Back button */}
            <div className="flex items-center gap-2 mb-4 pb-2 border-b">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleBackToList}
                className="gap-1 -ml-2"
              >
                <ChevronLeft className="size-4" />
                Back to Plugins
              </Button>
              <div className="flex-1" />
              <Badge variant="outline">
                {selectedPlugin.name}
                {selectedPlugin.version && ` v${selectedPlugin.version}`}
              </Badge>
            </div>

            <Tabs
              value={activeTab}
              onValueChange={setActiveTab}
              className="flex-1 flex flex-col overflow-hidden5"
            >
              <TabsList className="grid w-full grid-cols-3 mb-4">
                <TabsTrigger value="overview" className="gap-2">
                  <Info className="size-4" />
                  Overview
                </TabsTrigger>
                <TabsTrigger
                  value="schema"
                  className="gap-2"
                  disabled={
                    !selectedPlugin.schema ||
                    Object.keys(selectedPlugin.schema).length === 0
                  }
                >
                  <FileJson className="size-4" />
                  Schema
                </TabsTrigger>
                <TabsTrigger
                  value="examples"
                  className="gap-2"
                  disabled={
                    !selectedPlugin.examples ||
                    selectedPlugin.examples.length === 0
                  }
                >
                  <Eye className="size-4" />
                  Examples{' '}
                  {selectedPlugin.examples &&
                    `(${selectedPlugin.examples.length})`}
                </TabsTrigger>
              </TabsList>

              {/* Overview Tab */}
              <TabsContent value="overview" className="flex-1 overflow-hidden">
                <ScrollArea className="h-[500px] pr-4">
                  <div className="space-y-4">
                    <div>
                      <h3 className="text-lg font-semibold flex items-center gap-2">
                        <Code className="size-5 text-blue-600 dark:text-blue-400" />
                        {selectedPlugin.name}
                      </h3>
                      {selectedPlugin.version && (
                        <Badge variant="outline" className="mt-2 mb-1">
                          Version {selectedPlugin.version}
                        </Badge>
                      )}
                    </div>

                    {selectedPlugin.description && (
                      <div>
                        <h4 className="text-sm font-medium mb-1">
                          Description
                        </h4>
                        <p className="text-sm text-muted-foreground">
                          {selectedPlugin.description}
                        </p>
                      </div>
                    )}

                    <div>
                      <h4 className="text-sm font-medium mb-1">Location</h4>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        {getLocationIcon(selectedPlugin.location)}
                        <span>{getLocationLabel(selectedPlugin.location)}</span>
                        <span className="text-xs">
                          ({selectedPlugin.relativePath})
                        </span>
                      </div>
                    </div>

                    {selectedPlugin.schema?.properties && (
                      <div>
                        <h4 className="text-sm font-medium mb-2">
                          Configuration Properties (Quick Preview)
                        </h4>
                        <div className="space-y-1">
                          {Object.entries(selectedPlugin.schema.properties)
                            .slice(0, 5)
                            .map(([key, prop]: [string, any]) => (
                              <div key={key} className="text-xs">
                                <span className="font-mono font-medium">
                                  {key}
                                </span>
                                {prop.type && (
                                  <span className="text-muted-foreground ml-2">
                                    ({prop.type})
                                    {prop.optional ? ' - optional' : ''}
                                  </span>
                                )}
                              </div>
                            ))}
                          {Object.keys(selectedPlugin.schema.properties)
                            .length > 5 && (
                            <div className="text-xs text-muted-foreground">
                              ...and{' '}
                              {Object.keys(selectedPlugin.schema.properties)
                                .length - 5}{' '}
                              more properties. View the Schema tab for complete
                              details.
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>

              {/* Schema Tab */}
              <TabsContent value="schema" className="flex-1 overflow-hidden">
                <SchemaViewer
                  schema={selectedPlugin.schema?.jsonSchema || null}
                  loading={false}
                  className="h-[500px]"
                />
              </TabsContent>

              {/* Examples Tab */}
              <TabsContent value="examples" className="flex-1 overflow-hidden">
                {selectedPlugin.examples &&
                selectedPlugin.examples.length > 0 ? (
                  <>
                    {/* Examples List View */}
                    {exampleView === 'list' &&
                      selectedPlugin.examples.length > 1 && (
                        <ScrollArea className="h-[500px]">
                          <div className="space-y-3">
                            {selectedPlugin.examples.map((example, index) => (
                              <div
                                key={index}
                                className="p-4 border rounded-lg hover:bg-muted cursor-pointer transition-colors group"
                                onClick={() => {
                                  setSelectedExample(index);
                                  setExampleView('detail');
                                }}
                              >
                                <div className="flex items-start justify-between">
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                      <Badge
                                        variant="secondary"
                                        className="text-xs"
                                      >
                                        Example {index + 1}
                                      </Badge>
                                      <h3 className="font-semibold text-sm">
                                        {example.title ||
                                          `Example ${index + 1}`}
                                      </h3>
                                    </div>
                                    {example.description && (
                                      <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
                                        {example.description}
                                      </p>
                                    )}
                                  </div>
                                  <ChevronRight className="size-5 text-muted-foreground mt-1 group-hover:translate-x-1 transition-transform" />
                                </div>
                              </div>
                            ))}
                          </div>
                        </ScrollArea>
                      )}

                    {/* Example Detail View */}
                    {(exampleView === 'detail' ||
                      selectedPlugin.examples.length === 1) &&
                      selectedPlugin.examples[selectedExample] && (
                        <>
                          {/* Back button for multiple examples */}
                          {selectedPlugin.examples.length > 1 && (
                            <div className="flex items-center gap-2 mb-4 pb-2 border-b">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setExampleView('list')}
                                className="gap-1 -ml-2"
                              >
                                <ChevronLeft className="size-4" />
                                Back to Examples
                              </Button>
                              <div className="flex-1" />
                              <Badge variant="secondary" className="text-xs">
                                Example {selectedExample + 1} of{' '}
                                {selectedPlugin.examples.length}
                              </Badge>
                            </div>
                          )}

                          <ScrollArea className="max-h-[50vh]">
                            <div className="space-y-4">
                              {selectedPlugin.examples[selectedExample]
                                .title && (
                                <h3 className="text-lg font-semibold">
                                  {
                                    selectedPlugin.examples[selectedExample]
                                      .title
                                  }
                                </h3>
                              )}

                              {selectedPlugin.examples[selectedExample]
                                .description && (
                                <p className="text-sm text-muted-foreground">
                                  {
                                    selectedPlugin.examples[selectedExample]
                                      .description
                                  }
                                </p>
                              )}

                              <div>
                                <div className="flex items-center justify-between mb-2">
                                  <h4 className="text-sm font-medium">
                                    Full Component Configuration
                                  </h4>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() =>
                                      copyExample(
                                        selectedPlugin.examples![
                                          selectedExample
                                        ],
                                        selectedExample
                                      )
                                    }
                                  >
                                    {copiedIndex === selectedExample ? (
                                      <>
                                        <CheckCircle className="size-4 mr-2 text-green-600" />
                                        Copied!
                                      </>
                                    ) : (
                                      <>
                                        <Copy className="size-4 mr-2" />
                                        Copy
                                      </>
                                    )}
                                  </Button>
                                </div>

                                <pre className="p-4 bg-muted rounded-lg overflow-x-auto">
                                  <code className="text-sm">
                                    {JSON.stringify(
                                      selectedPlugin.examples[selectedExample]
                                        .props,
                                      null,
                                      2
                                    )}
                                  </code>
                                </pre>
                              </div>
                            </div>
                          </ScrollArea>
                        </>
                      )}
                  </>
                ) : (
                  <div className="text-center text-muted-foreground py-12">
                    <Eye className="size-12 mx-auto mb-3 opacity-20" />
                    <p>No examples available for this plugin</p>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>
        )}
      </div>
    </>
  );
}
