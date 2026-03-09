import React, { useState, useEffect, useCallback } from 'react';
import { Copy, Check } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { SchemaViewer } from './schema-viewer';
import { schemaService, SchemaType } from '../../lib/schema-service';
import { copySchemaToClipboard } from '../../lib/clipboard';
import { useToast } from '../ui/use-toast';
import { usePluginsStore } from '../../store/plugins-store';

interface SchemaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTab?: SchemaType;
}

/**
 * Dialog for viewing and copying JSON schemas
 */
export const SchemaDialog: React.FC<SchemaDialogProps> = ({
  open,
  onOpenChange,
  defaultTab = 'document',
}) => {
  const [activeTab, setActiveTab] = useState<SchemaType>(defaultTab);
  const [documentSchema, setDocumentSchema] = useState<any>(null);
  const [themeSchema, setThemeSchema] = useState<any>(null);
  const [loadingDocument, setLoadingDocument] = useState(false);
  const [loadingTheme, setLoadingTheme] = useState(false);
  const [errorDocument, setErrorDocument] = useState<string | null>(null);
  const [errorTheme, setErrorTheme] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
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
    if (themeSchema) return;

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
      setDocumentSchema(null);
      setErrorDocument(null);
    }
  }, [open]);

  // Load schema when dialog opens or tab/plugins change
  useEffect(() => {
    if (!open) return;

    const pluginsChanged =
      selectedPluginNames.length !== previousPlugins.length ||
      selectedPluginNames.some((name, i) => name !== previousPlugins[i]);

    if (activeTab === 'document') {
      if (!documentSchema || pluginsChanged) {
        if (pluginsChanged) {
          schemaService.clearPluginSchemaCache();
          setPreviousPlugins([...selectedPluginNames]);
        }
        if (!loadingDocument) {
          loadDocumentSchema();
        }
      }
    } else if (activeTab === 'theme') {
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

  const pluginCount = selectedPluginNames.length;

  const activeSchema = activeTab === 'document' ? documentSchema : themeSchema;

  const handleCopy = async () => {
    if (!activeSchema) return;
    try {
      const success = await copySchemaToClipboard(activeSchema);
      if (success) {
        setCopied(true);
        toast({
          title: 'Schema copied',
          description: 'The JSON schema has been copied to your clipboard',
        });
        setTimeout(() => setCopied(false), 2000);
      }
    } catch (error) {
      console.error('Copy failed:', error);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Schema Viewer</DialogTitle>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as SchemaType)}
          className="flex-1 overflow-hidden flex flex-col"
        >
          <div className="flex items-center gap-2">
            <TabsList>
              <TabsTrigger value="document" className="flex items-center gap-1">
                Document
                {pluginCount > 0 && (
                  <Badge variant="secondary" className="ml-1 text-xs px-1 py-0">
                    +{pluginCount}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="theme">Theme</TabsTrigger>
            </TabsList>
            <div className="ml-auto">
              <Button
                variant="ghost"
                size="icon"
                onClick={handleCopy}
                disabled={copied || !activeSchema}
                aria-label="Copy schema"
              >
                {copied ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          <div className="flex-1 overflow-auto mt-4">
            <TabsContent value="document" className="h-full">
              <SchemaViewer
                schema={documentSchema}
                loading={loadingDocument}
                error={errorDocument || undefined}
              />
            </TabsContent>

            <TabsContent value="theme" className="h-full">
              <SchemaViewer
                schema={themeSchema}
                loading={loadingTheme}
                error={errorTheme || undefined}
              />
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};
