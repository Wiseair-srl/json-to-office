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
import type { Mode } from '../../lib/types';
import type { DocumentMetadata, ThemeMetadata } from '../../hooks/useDiscovery';
import {
  getDocumentFormDefaultValues,
  getDocumentFormSchema,
  isNewDocumentName,
  type DocumentFormData,
} from '../../lib/validation';
import { FORMAT } from '../../lib/env';

const getLabels = (isTheme?: boolean) => ({
  create: {
    title: isTheme ? 'New Theme' : 'New Document',
    description: isTheme
      ? 'Create a new theme based on discovered themes in your project.'
      : 'Create a new document based on discovered documents in your project.',
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

function DocumentFormDialogContent({
  mode,
  shouldReset,
  postSubmit,
  selectedName,
  discoveredDocuments,
  discoveredThemes,
  isTheme,
}: {
  mode: Mode;
  shouldReset: boolean;
  postSubmit: () => void;
  selectedName?: string;
  discoveredDocuments?: DocumentMetadata[];
  discoveredThemes?: ThemeMetadata[];
  isTheme?: boolean;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedItemContent, setSelectedItemContent] = useState<string | null>(
    null
  );
  const labels = getLabels(isTheme);
  const {
    documents,
    openTabs,
    createDocument,
    renameDocument,
    deleteDocument,
    openDocument,
    closeDocument,
  } = useDocumentsStore((state) => state);
  const { updateTheme } = useThemesStore((state) => state);
  const renameThreadsForDocument = useChatStore((s) => s.renameThreadsForDocument);
  const deleteThreadsForDocument = useChatStore((s) => s.deleteThreadsForDocument);

  // Prepare discovered items for the form
  const discoveredItems: DiscoveredItem[] = useMemo(() => {
    if (isTheme) {
      return discoveredThemes || [];
    } else {
      return discoveredDocuments || [];
    }
  }, [isTheme, discoveredDocuments, discoveredThemes]);

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

  const schemaResult = useMemo(
    () =>
      getDocumentFormSchema(
        mode,
        (v) => isNewDocumentName(v, documents, selectedName),
        templates
      ),
    [mode, documents, selectedName, templates]
  );

  const schema = schemaResult.schema;

  // Build a map from path -> item for quick lookups (paths are unique)
  const itemsByPath = useMemo(() => {
    const map = new Map<string, DiscoveredItem>();
    discoveredItems.forEach((item) => map.set(item.path, item));
    return map;
  }, [discoveredItems]);

  const defaultTemplatePath =
    discoveredItems.length > 0 ? discoveredItems[0].path : undefined;

  const form = useForm<DocumentFormData>({
    resolver: createTypeBoxResolver(schemaResult.validate),
    defaultValues: getDocumentFormDefaultValues(
      mode,
      discoveredItems.length > 0 ? discoveredItems[0].name : undefined,
      selectedName
    ),
  });

  // Track selected path separately from the form's template field (which stores the name)
  const [selectedPath, setSelectedPath] = useState<string | undefined>(
    defaultTemplatePath
  );

  // Set initial name when form first loads with a default template
  useEffect(() => {
    if (
      mode === 'create' &&
      discoveredItems.length > 0 &&
      !form.getValues('name')
    ) {
      const defaultTemplate = discoveredItems[0].name;
      form.setValue('name', defaultTemplate);
    }
  }, [mode, discoveredItems, form]);

  // Load content when selected path changes
  useEffect(() => {
    if (selectedPath && mode === 'create') {
      const item = itemsByPath.get(selectedPath);
      if (item) {
        fetch(
          `/api/discovery/${isTheme ? 'themes' : 'documents'}/${encodeURIComponent(item.name)}/content`
        )
          .then((res) => {
            if (!res.ok) {
              throw new Error(`Failed to fetch content: ${res.statusText}`);
            }
            return res.text();
          })
          .then((content) => {
            try {
              const parsed = JSON.parse(content);
              setSelectedItemContent(JSON.stringify(parsed, null, 2));
            } catch (e) {
              console.error('Invalid JSON content received:', e);
              setSelectedItemContent(null);
            }
          })
          .catch((error) => {
            console.error('Failed to fetch content:', error);
            setSelectedItemContent(null);
          });
      }
    }
  }, [selectedPath, mode, itemsByPath, isTheme]);

  // reset form
  useEffect(() => {
    if (shouldReset) {
      form.reset();
      setSelectedItemContent(null);
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

        if (isTheme) {
          // Use discovered theme content or create default
          content =
            selectedItemContent ||
            JSON.stringify(
              {
                name: finalName
                  .replace(/\.(json|theme)$/i, '')
                  .toLowerCase()
                  .replace(/\s+/g, '-'),
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
              },
              null,
              2
            );
          // Ensure theme files have .theme.json extension
          if (
            !finalName.endsWith('.theme.json') &&
            !finalName.endsWith('.json')
          ) {
            finalName += '.theme.json';
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
                    title:
                        docItem?.title || finalName.replace(/\.(json|js)$/i, ''),
                    theme: docItem?.theme || 'default',
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
                        docItem?.title || finalName.replace(/\.(json|js)$/i, ''),
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
          if (
            !finalName.endsWith(docExt) &&
            !finalName.endsWith('.json')
          ) {
            finalName += docExt;
          }
        }

        createDocument(finalName, content);
        openDocument(finalName);

        // If this is a theme, sync it to the themes store immediately
        if (isTheme) {
          updateTheme(finalName, content);
        }
      } else if (mode === 'update') {
        const oldName = selectedName as string;
        const newName = name as string;
        const isOpen = openTabs.includes(oldName);
        if (isOpen) closeDocument(oldName);
        renameDocument(oldName, newName);
        renameThreadsForDocument(oldName, newName);
        if (isOpen) openDocument(newName);
      } else if (mode === 'delete') {
        const oldName = selectedName as string;
        closeDocument(oldName);
        deleteDocument(oldName);
        deleteThreadsForDocument(oldName);
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
          {schema.properties && 'template' in schema.properties && (
            <FormField
              control={form.control}
              name="template"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {isTheme ? 'Base Theme' : 'Base Document'}
                  </FormLabel>
                  <Select
                    onValueChange={(path) => {
                      const item = itemsByPath.get(path);
                      if (item) {
                        field.onChange(item.name);
                        form.setValue('name', item.name);
                        setSelectedPath(path);
                      }
                    }}
                    defaultValue={defaultTemplatePath}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue
                          placeholder={`Select a discovered ${isTheme ? 'theme' : 'document'}`}
                        />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent className="max-h-[300px]">
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
                              let displayName = item.name;
                              if (item.title) {
                                displayName = `${item.name} - ${item.title}`;
                              } else if (item.description) {
                                const shortDesc =
                                  item.description.length > 40
                                    ? item.description.substring(0, 40) + '...'
                                    : item.description;
                                displayName = `${item.name} - ${shortDesc}`;
                              }

                              return (
                                <SelectItem
                                  value={item.path}
                                  key={item.path}
                                  className="pl-6"
                                >
                                  {displayName}
                                </SelectItem>
                              );
                            })}
                          </SelectGroup>
                        );
                      })}
                      {discoveredItems.length === 0 && (
                        <div className="px-2 py-4 text-center text-sm text-muted-foreground">
                          No {isTheme ? 'themes' : 'documents'} discovered in
                          project
                        </div>
                      )}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    Select a discovered {isTheme ? 'theme' : 'document'} to use
                    as a starting point
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
            disabled={
              isSubmitting ||
              (mode === 'create' && discoveredItems.length === 0)
            }
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
