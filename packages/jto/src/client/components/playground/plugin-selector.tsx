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
import { useToast } from '../ui/use-toast';
import { usePluginsStore } from '../../store/plugins-store';

interface PluginSelectorProps {
  plugins: PluginMetadata[];
  onClose: () => void;
}

export function PluginSelector({
  plugins,
  onClose: _onClose,
}: PluginSelectorProps) {
  const { toast } = useToast();
  const togglePlugin = usePluginsStore((state) => state.togglePlugin);
  const isPluginSelected = usePluginsStore((state) => state.isPluginSelected);
  const clearSelections = usePluginsStore((state) => state.clearSelections);
  const selectedPlugins = usePluginsStore((state) => state.selectedPlugins);
  const applyPluginsWithValidation = usePluginsStore(
    (state) => state.applyPluginsWithValidation
  );
  const isApplyingPlugins = usePluginsStore((state) => state.isApplyingPlugins);

  const [selectedPlugin, setSelectedPlugin] = useState<PluginMetadata | null>(
    null
  );
  const [currentView, setCurrentView] = useState<'list' | 'detail'>('list');
  const [activeTab, setActiveTab] = useState('overview');
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [selectedExample, setSelectedExample] = useState(0);
  const [exampleView, setExampleView] = useState<'list' | 'detail'>('list');

  const selectedPluginNames = Array.from(selectedPlugins);

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
          your project.{' '}
          {selectedPluginNames.length > 0 && (
            <span className="text-primary font-medium">
              {selectedPluginNames.length} selected
            </span>
          )}
        </DialogDescription>
      </DialogHeader>

      {/* Action buttons for list view */}
      {currentView === 'list' && selectedPluginNames.length > 0 && (
        <div className="flex items-center justify-between mt-4 p-2 bg-muted/50 rounded-lg">
          <div className="text-sm text-muted-foreground">
            {selectedPluginNames.length} plugin
            {selectedPluginNames.length !== 1 ? 's' : ''} selected
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={clearSelections}>
              Clear All
            </Button>
            <Button
              size="sm"
              disabled={isApplyingPlugins}
              onClick={async () => {
                console.log(
                  'Apply Selection clicked with plugins:',
                  selectedPluginNames
                );

                // Apply plugins with validation
                await applyPluginsWithValidation(
                  // Success callback
                  () => {
                    toast({
                      title: 'Plugins Applied Successfully!',
                      description: `${selectedPluginNames.length} plugin${selectedPluginNames.length !== 1 ? 's' : ''} have been applied. Autocomplete and validation are now updated.`,
                      className: 'border-green-500',
                    });
                    _onClose();
                  },
                  // Error callback
                  (error) => {
                    toast({
                      title: 'Failed to Apply Plugins',
                      description:
                        error ||
                        'Unable to update schema validation. Please try again.',
                      variant: 'destructive',
                    });
                  }
                );
              }}
            >
              {isApplyingPlugins ? (
                <>
                  <div className="size-4 mr-1 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  Applying...
                </>
              ) : (
                <>
                  <Check className="size-4 mr-1" />
                  Apply Selection
                </>
              )}
            </Button>
          </div>
        </div>
      )}

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

                    <div className="space-y-2">
                      {locationPlugins.map((plugin) => {
                        const isSelected = isPluginSelected(plugin.name);
                        return (
                          <div
                            key={plugin.name}
                            className={cn(
                              'flex items-center justify-between p-3 rounded-lg border transition-colors group',
                              isSelected && 'bg-primary/10 border-primary',
                              'hover:bg-accent/50'
                            )}
                          >
                            <div
                              className="flex-1 cursor-pointer"
                              onClick={() => handlePluginSelect(plugin)}
                            >
                              <div className="flex items-center gap-2">
                                <Code className="size-4 text-blue-600 dark:text-blue-400" />
                                <span className="font-medium">
                                  {plugin.name}
                                </span>
                                {plugin.version && (
                                  <Badge variant="outline" className="text-xs">
                                    v{plugin.version}
                                  </Badge>
                                )}
                              </div>
                              {plugin.description && (
                                <p className="text-xs text-muted-foreground mt-1">
                                  {plugin.description}
                                </p>
                              )}
                              <div className="text-xs text-muted-foreground mt-1">
                                {plugin.relativePath}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {isSelected && (
                                <CheckCircle className="size-4 text-primary" />
                              )}
                              <Button
                                size="sm"
                                variant={isSelected ? 'secondary' : 'outline'}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  togglePlugin(plugin);
                                }}
                              >
                                {isSelected ? 'Selected' : 'Select'}
                              </Button>
                              <ChevronRight className="size-4 text-muted-foreground group-hover:translate-x-1 transition-transform" />
                            </div>
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

                      <div className="mt-4 p-3 bg-muted rounded-lg">
                        <div className="flex items-start gap-2">
                          <FileText className="size-4 text-muted-foreground mt-0.5" />
                          <div className="text-xs text-muted-foreground">
                            <p className="font-medium mb-1">How to use:</p>
                            <ol className="list-decimal list-inside space-y-1">
                              <li>Copy the example configuration</li>
                              <li>
                              Paste it into your document's children array
                              </li>
                              <li>Adjust the configuration values as needed</li>
                            </ol>
                          </div>
                        </div>
                      </div>
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
