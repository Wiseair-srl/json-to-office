import React, { useState, useEffect, useCallback } from 'react';
import { FileJson, FileCode } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Button } from '../ui/button';
import { SchemaViewer } from './schema-viewer';
import { schemaService, SchemaType } from '../../lib/schema-service';
import { useToast } from '../ui/use-toast';
import { usePluginsStore } from '../../store/plugins-store';
import { Badge } from '../ui/badge';

interface SchemaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTab?: SchemaType;
  activeDocumentType?: 'document' | 'theme';
}

/**
 * Dialog for viewing and copying JSON schemas
 */
export const SchemaDialog: React.FC<SchemaDialogProps> = ({
  open,
  onOpenChange,
  defaultTab = 'document',
  activeDocumentType,
}) => {
  const [activeTab, setActiveTab] = useState<SchemaType>(defaultTab);
  const [documentSchema, setDocumentSchema] = useState<any>(null);
  const [themeSchema, setThemeSchema] = useState<any>(null);
  const [loadingDocument, setLoadingDocument] = useState(false);
  const [loadingTheme, setLoadingTheme] = useState(false);
  const [errorDocument, setErrorDocument] = useState<string | null>(null);
  const [errorTheme, setErrorTheme] = useState<string | null>(null);
  const { toast } = useToast();
  const selectedPlugins = usePluginsStore((state) => state.selectedPlugins);
  const selectedPluginNames = Array.from(selectedPlugins);

  // Update active tab when defaultTab changes
  useEffect(() => {
    if (defaultTab) {
      setActiveTab(defaultTab);
    }
  }, [defaultTab]);

  // Load document schema
  const loadDocumentSchema = useCallback(async () => {
    setLoadingDocument(true);
    setErrorDocument(null);

    try {
      // Include selected plugins in schema generation
      const schema =
        await schemaService.fetchDocumentSchema(selectedPluginNames);
      setDocumentSchema(schema);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to load document schema';
      setErrorDocument(message);
      toast({
        variant: 'destructive',
        title: 'Error loading schema',
        description: message,
      });
    } finally {
      setLoadingDocument(false);
    }
  }, [selectedPluginNames, toast]);

  // Load theme schema
  const loadThemeSchema = useCallback(async () => {
    if (themeSchema) return; // Already loaded

    setLoadingTheme(true);
    setErrorTheme(null);

    try {
      const schema = await schemaService.fetchThemeSchema();
      setThemeSchema(schema);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to load theme schema';
      setErrorTheme(message);
      toast({
        variant: 'destructive',
        title: 'Error loading schema',
        description: message,
      });
    } finally {
      setLoadingTheme(false);
    }
  }, [themeSchema, toast]);

  // Track previous plugin state to detect changes
  const [previousPlugins, setPreviousPlugins] = useState<string[]>([]);

  // Reset schema when dialog closes to force refresh on next open
  useEffect(() => {
    if (!open) {
      // Clear document schema to force reload on next open
      setDocumentSchema(null);
      setErrorDocument(null);
    }
  }, [open]);

  // Load schema when dialog opens or tab/plugins change
  useEffect(() => {
    if (!open) return;

    // Check if plugins have actually changed
    const pluginsChanged =
      selectedPluginNames.length !== previousPlugins.length ||
      selectedPluginNames.some((name, i) => name !== previousPlugins[i]);

    if (activeTab === 'document') {
      // Load document schema if not loaded or plugins changed
      if (!documentSchema || pluginsChanged) {
        if (pluginsChanged) {
          // Clear cache only when plugins actually change
          schemaService.clearPluginSchemaCache();
          setPreviousPlugins([...selectedPluginNames]);
        }
        if (!loadingDocument) {
          loadDocumentSchema();
        }
      }
    } else if (activeTab === 'theme') {
      // Load theme schema if not loaded
      if (!themeSchema && !loadingTheme) {
        loadThemeSchema();
      }
    }
  }, [
    activeTab,
    open,
    documentSchema,
    themeSchema,
    loadingDocument,
    loadingTheme,
    selectedPluginNames,
    previousPlugins,
    loadDocumentSchema,
    loadThemeSchema,
  ]);

  // Show plugin badge in document tab
  const pluginCount = selectedPluginNames.length;

  // Handle copy success
  const handleCopySuccess = () => {
    toast({
      title: 'Schema copied',
      description: 'The JSON schema has been copied to your clipboard',
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileJson className="h-5 w-5" />
            JSON Schema Viewer
          </DialogTitle>
          <DialogDescription>
            View and copy the JSON schemas used for validating documents and
            themes.
            {activeDocumentType && (
              <span className="block mt-1 text-primary">
                Currently editing:{' '}
                {activeDocumentType === 'theme' ? 'Theme' : 'Document'}
              </span>
            )}
            {pluginCount > 0 && (
              <span className="block mt-1">
                <Badge variant="secondary" className="text-xs">
                  {pluginCount} plugin{pluginCount !== 1 ? 's' : ''} included in
                  schema
                </Badge>
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as SchemaType)}
          className="flex-1 overflow-hidden flex flex-col"
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="document" className="flex items-center gap-2">
              <FileCode className="h-4 w-4" />
              Document Schema
              {pluginCount > 0 && (
                <Badge variant="secondary" className="ml-1 text-xs px-1 py-0">
                  +{pluginCount}
                </Badge>
              )}
              {activeDocumentType === 'document' && (
                <span className="ml-1 text-xs text-primary">●</span>
              )}
            </TabsTrigger>
            <TabsTrigger value="theme" className="flex items-center gap-2">
              <FileCode className="h-4 w-4" />
              Theme Schema
              {activeDocumentType === 'theme' && (
                <span className="ml-1 text-xs text-primary">●</span>
              )}
            </TabsTrigger>
          </TabsList>

          <div className="flex-1 overflow-auto mt-4">
            <TabsContent value="document" className="h-full">
              <SchemaViewer
                schema={documentSchema}
                loading={loadingDocument}
                error={errorDocument || undefined}
                onCopy={handleCopySuccess}
              />
            </TabsContent>

            <TabsContent value="theme" className="h-full">
              <SchemaViewer
                schema={themeSchema}
                loading={loadingTheme}
                error={errorTheme || undefined}
                onCopy={handleCopySuccess}
              />
            </TabsContent>
          </div>
        </Tabs>

        <div className="flex justify-end pt-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
