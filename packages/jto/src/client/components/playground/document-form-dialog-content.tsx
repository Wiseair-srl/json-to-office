import React, { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { createTypeBoxResolver } from '../../lib/typebox-resolver';
import { Button } from '../ui/button';
import { Spinner } from '../ui/spinner';
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from '../ui/form';
import { Input } from '../ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { useDocumentsStore } from '../../store/documents-store-provider';
import { useThemesStore } from '../../store/themes-store-provider';
import { useChatStore } from '../../store/chat-store-provider';
import { useToast } from '../ui/use-toast';
import type { Mode } from '../../lib/types';
import type {
  DocumentMetadata,
  PluginMetadata,
  ThemeMetadata,
} from '../../hooks/useDiscovery';
import { useBrowserPluginsStore } from '../../store/browser-plugins-store';
import { pluginDocumentName } from '../../store/documents-store';
import {
  componentNameFromFileName,
  declaredComponentName,
  pluginStarterSource,
  renameDeclaredComponent,
} from '../../lib/plugins/templates';
import {
  getDocumentFormDefaultValues,
  getDocumentFormSchema,
  isNewDocumentName,
  type DocumentFormData,
} from '../../lib/validation';
import { FORMAT } from '../../lib/env';
import { createMinimalTheme } from '@json-to-office/shared-docx';

type FileKind = 'document' | 'theme' | 'plugin';

const getLabels = (kind: FileKind) => ({
  create: {
    title:
      kind === 'theme'
        ? 'New Theme'
        : kind === 'plugin'
          ? 'New Plugin'
          : 'New Document',
    description:
      kind === 'theme'
        ? 'Create a new theme from scratch or based on discovered themes.'
        : kind === 'plugin'
          ? 'Write a custom component in TypeScript. It compiles and runs in your browser; documents use it by name like any built-in component.'
          : 'Create a new document from scratch or based on discovered documents.',
    button: 'Create',
    buttonVariant: 'default',
  },
  update: {
    title: 'Rename Document',
    description: 'Give your document a new name.',
    button: 'Save',
    buttonVariant: 'default',
  },
  delete: {
    title: 'Are you absolutely sure?',
    description:
      'This action cannot be undone. Are you sure you want to permanently delete this document?',
    button: 'Confirm',
    buttonVariant: 'destructive',
  },
});

interface DiscoveredItem {
  name: string;
  path: string;
  location: 'current' | 'downstream';
  title?: string;
  description?: string;
  theme?: string;
}

const EMPTY_TEMPLATE_VALUE = '__empty__';

function DocumentFormDialogContent({
  mode,
  shouldReset,
  postSubmit,
  selectedName,
  discoveredDocuments,
  discoveredThemes,
  discoveredPlugins,
  isTheme,
  isPlugin,
}: {
  mode: Mode;
  shouldReset: boolean;
  postSubmit: () => void;
  selectedName?: string;
  discoveredDocuments?: DocumentMetadata[];
  discoveredThemes?: ThemeMetadata[];
  /** Plugins found on disk, offered as starting points for a browser plugin. */
  discoveredPlugins?: PluginMetadata[];
  isTheme?: boolean;
  isPlugin?: boolean;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedItemContent, setSelectedItemContent] = useState<string | null>(
    null
  );
  // Tracks the template copy independently of its content: a null
  // `selectedItemContent` means "start from scratch" when idle, but "the copy
  // failed" when errored — the two must not both fall back to the scaffold.
  const [templateStatus, setTemplateStatus] = useState<
    'idle' | 'loading' | 'error'
  >('idle');
  const { toast } = useToast();
  const kind: FileKind = isPlugin ? 'plugin' : isTheme ? 'theme' : 'document';
  const labels = getLabels(kind);
  const {
    documents,
    openTabs,
    createDocument,
    renameDocument,
    deleteDocument,
    openDocument,
    closeDocument,
    documentTypes,
  } = useDocumentsStore((state) => state);
  const { updateTheme, removeTheme } = useThemesStore((state) => state);
  const renameBrowserPlugin = useBrowserPluginsStore((s) => s.rename);
  const removeBrowserPlugin = useBrowserPluginsStore((s) => s.remove);
  const renameThreadsForDocument = useChatStore(
    (s) => s.renameThreadsForDocument
  );
  const deleteThreadsForDocument = useChatStore(
    (s) => s.deleteThreadsForDocument
  );

  // Prepare discovered items for the form
  const discoveredItems: DiscoveredItem[] = useMemo(() => {
    if (kind === 'plugin') {
      // A disk plugin's identity is its file: the name is the component name
      // and the path is where discovery found it.
      return (discoveredPlugins || []).map((plugin) => ({
        name: plugin.name,
        path: plugin.filePath,
        location: plugin.location === 'current' ? 'current' : 'downstream',
        description: plugin.description,
      }));
    }
    if (kind === 'theme') {
      return discoveredThemes || [];
    }
    return discoveredDocuments || [];
  }, [kind, discoveredDocuments, discoveredThemes, discoveredPlugins]);

  // Group items by location for better UX
  const groupedItems = useMemo(() => {
    const groups: Record<string, DiscoveredItem[]> = {
      current: [],
      downstream: [],
    };

    discoveredItems.forEach((item) => {
      if (groups[item.location]) {
        groups[item.location].push(item);
      }
    });

    return groups;
  }, [discoveredItems]);

  // Convert discovered items to the format expected by the validation schema
  const templates = useMemo(() => {
    return discoveredItems.map((item) => ({
      name: item.name,
      type: 'application/json',
      text: '', // We'll load this on demand
      mtime: new Date(),
      ctime: new Date(),
      atime: new Date(),
    }));
  }, [discoveredItems]);

  // A plugin is one on rename too: `documentTypes` decides, not the new name.
  const willBePlugin =
    kind === 'plugin' ||
    (mode === 'update' &&
      !!selectedName &&
      documentTypes[selectedName] === 'application/typescript+plugin');

  const schemaResult = useMemo(
    () =>
      getDocumentFormSchema(
        mode,
        (v) => isNewDocumentName(v, documents, selectedName),
        templates,
        willBePlugin ? pluginDocumentName : undefined
      ),
    [mode, documents, selectedName, templates, willBePlugin]
  );

  const schema = schemaResult.schema;

  // Build a map from path -> item for quick lookups (paths are unique)
  const itemsByPath = useMemo(() => {
    const map = new Map<string, DiscoveredItem>();
    discoveredItems.forEach((item) => map.set(item.path, item));
    return map;
  }, [discoveredItems]);

  const defaultTemplatePath = EMPTY_TEMPLATE_VALUE;

  const form = useForm<DocumentFormData>({
    resolver: createTypeBoxResolver(schemaResult.validate),
    defaultValues: getDocumentFormDefaultValues(mode, undefined, selectedName),
  });

  // Track selected path separately from the form's template field (which stores the name)
  const [selectedPath, setSelectedPath] = useState<string | undefined>(
    defaultTemplatePath
  );

  // Load content when selected path changes
  useEffect(() => {
    if (
      selectedPath &&
      selectedPath !== EMPTY_TEMPLATE_VALUE &&
      mode === 'create'
    ) {
      const item = itemsByPath.get(selectedPath);
      if (item) {
        // Drop the previous template's content up front: while this fetch is
        // in flight the selection no longer matches what we hold.
        setSelectedItemContent(null);
        setTemplateStatus('loading');
        let cancelled = false;
        const url =
          kind === 'plugin'
            ? `/api/discovery/plugins/${encodeURIComponent(item.name)}/source`
            : `/api/discovery/${kind === 'theme' ? 'themes' : 'documents'}/${encodeURIComponent(item.name)}/content`;
        fetch(url)
          .then((res) => {
            if (!res.ok) {
              throw new Error(`Failed to fetch content: ${res.statusText}`);
            }
            return res.text();
          })
          .then((content) => {
            if (cancelled) return;
            if (kind === 'plugin') {
              // A copy that kept the disk plugin's component name would lose
              // to it the moment it compiled; the fork starts as its own.
              const declared = declaredComponentName(content);
              setSelectedItemContent(
                declared
                  ? renameDeclaredComponent(content, `${declared}-custom`)
                  : content
              );
            } else {
              // Throws on malformed JSON, handled below like any fetch failure.
              const parsed = JSON.parse(content);
              setSelectedItemContent(JSON.stringify(parsed, null, 2));
            }
            setTemplateStatus('idle');
          })
          .catch((error) => {
            if (cancelled) return;
            console.error('Failed to copy template:', error);
            setSelectedItemContent(null);
            setTemplateStatus('error');
          });
        return () => {
          cancelled = true;
        };
      }
    }
    setTemplateStatus('idle');
  }, [selectedPath, mode, itemsByPath, kind]);

  // reset form
  useEffect(() => {
    if (shouldReset) {
      form.reset();
      setSelectedItemContent(null);
      setTemplateStatus('idle');
      setSelectedPath(defaultTemplatePath);
    }
  }, [form, shouldReset]);

  const onSubmit = form.handleSubmit(async ({ name, template }) => {
    setIsSubmitting(true);
    try {
      // Add a small delay to show loading state for UX
      await new Promise((resolve) => setTimeout(resolve, 200));

      if (mode === 'create') {
        const selectedItem = selectedPath
          ? itemsByPath.get(selectedPath)
          : discoveredItems.find((i) => i.name === template);
        let content: string;
        let finalName = name as string;

        // A template was picked but its content never arrived. Creating the
        // file anyway would produce something named after the template and
        // containing none of it, so stop instead of falling back.
        const templatePicked =
          Boolean(selectedPath) && selectedPath !== EMPTY_TEMPLATE_VALUE;
        if (templatePicked && selectedItemContent === null) {
          toast({
            title:
              templateStatus === 'loading'
                ? 'Template still loading'
                : `Could not copy ${selectedItem?.name ?? 'the selected template'}`,
            description:
              templateStatus === 'loading'
                ? 'Wait for the template to finish loading, then try again.'
                : 'Pick another template, or create an empty one instead.',
            variant: 'destructive',
          });
          return;
        }

        if (kind === 'plugin') {
          // The file name decides the suffix and seeds the component name;
          // the source is either the disk plugin's or the format's starter.
          finalName = pluginDocumentName(finalName);
          content =
            selectedItemContent ||
            pluginStarterSource(FORMAT, componentNameFromFileName(finalName));
        } else if (isTheme) {
          // Use discovered theme content or create format-specific default
          const themeName = finalName
            .replace(/\.(json|theme)$/i, '')
            .toLowerCase()
            .replace(/\s+/g, '-');
          const defaultTheme =
            FORMAT === 'docx'
              ? // Scaffolded from shared-docx so a new theme is schema-valid on
                // creation instead of opening with validation errors.
                createMinimalTheme(themeName)
              : {
                  name: themeName,
                  colors: {
                    primary: '#2563EB',
                    secondary: '#64748B',
                    accent: '#F8FAFC',
                    background: '#FFFFFF',
                    text: '#334155',
                  },
                  fonts: {
                    heading: 'Calibri',
                    body: 'Calibri',
                  },
                  defaults: {
                    fontSize: 18,
                    fontColor: '#334155',
                  },
                };
          content =
            selectedItemContent || JSON.stringify(defaultTheme, null, 2);
          // Ensure theme files have format-specific .theme.json extension
          const themeExt = `.${FORMAT}.theme.json`;
          if (!finalName.endsWith(themeExt)) {
            // Strip partial extensions before appending the correct one
            finalName = finalName
              .replace(/\.(pptx|docx)\.theme\.json$/i, '')
              .replace(/\.theme\.json$/i, '')
              .replace(/\.json$/i, '');
            finalName += themeExt;
          }
        } else {
          // Use discovered document content or create default
          const docItem = selectedItem as DocumentMetadata | undefined;
          content =
            selectedItemContent ||
            JSON.stringify(
              FORMAT === 'docx'
                ? {
                    name: 'docx',
                    props: {
                      theme: docItem?.theme || 'default',
                      metadata: {
                        title:
                          docItem?.title ||
                          finalName.replace(/\.(json|js)$/i, ''),
                      },
                    },
                    children: [
                      {
                        name: 'section',
                        props: {},
                        children: [
                          {
                            name: 'paragraph',
                            props: {
                              text: 'Start writing your document content here...',
                            },
                          },
                        ],
                      },
                    ],
                  }
                : {
                    name: 'pptx',
                    props: {
                      title:
                        docItem?.title ||
                        finalName.replace(/\.(json|js)$/i, ''),
                      theme: docItem?.theme || 'default',
                    },
                    children: [
                      {
                        name: 'slide',
                        props: {},
                        children: [
                          {
                            name: 'text',
                            props: {
                              text: 'Start writing your presentation content here...',
                              fontSize: 24,
                              y: 2,
                              x: 1,
                              w: 8,
                            },
                          },
                        ],
                      },
                    ],
                  },
              null,
              2
            );
          // Ensure document files have format-specific extension
          const docExt = FORMAT === 'docx' ? '.docx.json' : '.pptx.json';
          if (!finalName.endsWith(docExt) && !finalName.endsWith('.json')) {
            finalName += docExt;
          }
        }

        // Auto-suffix if a document with this name already exists
        const extMatch = finalName.match(
          /(\.(pptx|docx)(\.theme)?\.json|\.json|\.component\.ts)$/i
        );
        const ext = extMatch ? extMatch[0] : '';
        const baseName = finalName.slice(0, finalName.length - ext.length);
        let deduped = finalName;
        let counter = 1;
        while (documents.some((d) => d.name === deduped)) {
          counter++;
          deduped = `${baseName} (${counter})${ext}`;
        }
        finalName = deduped;

        createDocument(finalName, content);
        openDocument(finalName);

        // If this is a theme, sync it to the themes store immediately
        if (isTheme) {
          updateTheme(finalName, content);
        }
      } else if (mode === 'update') {
        const oldName = selectedName as string;
        let newName = name as string;
        const wasPlugin =
          documentTypes[oldName] === 'application/typescript+plugin';
        // A plugin keeps its suffix: the type is decided by the name, and a
        // rename that dropped it would turn the file into a document.
        if (wasPlugin) newName = pluginDocumentName(newName);
        // The form validated the entered name against the stored one, so a
        // collision here means the documents changed under the dialog.
        if (newName !== oldName && documents.some((d) => d.name === newName)) {
          toast({
            title: `"${newName}" already exists`,
            description: 'Pick another name.',
            variant: 'destructive',
          });
          return;
        }
        const isOpen = openTabs.includes(oldName);
        if (isOpen) closeDocument(oldName);
        // The compiled record moves with the file before the sync sees the
        // new name, so the enable switches survive the rename.
        if (wasPlugin) renameBrowserPlugin(oldName, newName);
        renameDocument(oldName, newName);
        renameThreadsForDocument(oldName, newName);
        if (isOpen) openDocument(newName);
      } else if (mode === 'delete') {
        const oldName = selectedName as string;
        const wasPlugin =
          documentTypes[oldName] === 'application/typescript+plugin';
        closeDocument(oldName);
        deleteDocument(oldName);
        deleteThreadsForDocument(oldName);
        if (isTheme) {
          removeTheme(oldName);
        }
        if (wasPlugin) removeBrowserPlugin(oldName);
      }
      postSubmit();
    } finally {
      setIsSubmitting(false);
    }
  });

  return (
    <Form {...form}>
      <form onSubmit={onSubmit}>
        <DialogHeader>
          <DialogTitle>{labels[mode].title}</DialogTitle>
          <DialogDescription>{labels[mode].description}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-4">
          {schema.properties && 'name' in schema.properties && (
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Enter a name or select a template below"
                      autoComplete="off"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
          {mode === 'create' && (
            <FormField
              control={form.control}
              name="template"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {kind === 'theme'
                      ? 'Base Theme'
                      : kind === 'plugin'
                        ? 'Start from'
                        : 'Base Document'}
                  </FormLabel>
                  <Select
                    onValueChange={(path) => {
                      if (path === EMPTY_TEMPLATE_VALUE) {
                        field.onChange(undefined);
                        form.setValue('name', '');
                        setSelectedPath(EMPTY_TEMPLATE_VALUE);
                        setSelectedItemContent(null);
                      } else {
                        const item = itemsByPath.get(path);
                        if (item) {
                          field.onChange(item.name);
                          form.setValue('name', item.name);
                          setSelectedPath(path);
                        }
                      }
                    }}
                    defaultValue={defaultTemplatePath}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue
                          placeholder={`Select a discovered ${kind}`}
                        />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent className="max-h-[300px]">
                      <SelectItem value={EMPTY_TEMPLATE_VALUE}>
                        {kind === 'plugin'
                          ? `Starter ${FORMAT} component`
                          : `Empty ${kind}`}
                      </SelectItem>
                      {Object.entries(groupedItems).map(([location, items]) => {
                        if (items.length === 0) return null;

                        return (
                          <SelectGroup key={location}>
                            <SelectLabel>
                              {location === 'current'
                                ? '📁 Current Directory'
                                : '📦 Project'}
                            </SelectLabel>
                            {items.map((item) => {
                              let secondary: string | undefined;
                              if (item.title && item.title !== item.name) {
                                secondary = item.title;
                              } else if (item.description) {
                                secondary =
                                  item.description.length > 40
                                    ? item.description.substring(0, 40) + '...'
                                    : item.description;
                              }

                              return (
                                <SelectItem
                                  value={item.path}
                                  key={item.path}
                                  className="pl-6"
                                >
                                  <span className="flex flex-col">
                                    <span className="font-medium">
                                      {item.name}
                                    </span>
                                    {secondary && (
                                      <span className="text-muted-foreground text-xs">
                                        {secondary}
                                      </span>
                                    )}
                                  </span>
                                </SelectItem>
                              );
                            })}
                          </SelectGroup>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    {kind === 'plugin'
                      ? 'Start from the starter component, or copy a plugin discovered on disk — the copy is renamed "<name>-custom" so both can exist'
                      : `Start empty or select a discovered ${kind} as a starting point`}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
        </div>
        <DialogFooter>
          <Button
            type="submit"
            variant={labels[mode].buttonVariant as 'default' | 'destructive'}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Spinner size="sm" className="mr-2" />
                {mode === 'create'
                  ? 'Creating...'
                  : mode === 'update'
                    ? 'Saving...'
                    : 'Deleting...'}
              </>
            ) : (
              labels[mode].button
            )}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}

export const DocumentFormDialogContentMemoized = React.memo(
  DocumentFormDialogContent
);
