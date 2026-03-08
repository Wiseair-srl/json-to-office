import { useEffect, useCallback, useRef, useMemo, memo } from 'react';
import { EditorTabsContentMemoized } from './editor-tabs-content';
import { Tabs } from '../ui/tabs';
import { useDocumentsStore } from '../../store/documents-store-provider';
import { useOutputStore } from '../../store/output-store-provider';
import { useSettingsStore } from '../../store/settings-store-provider';
import { useThemesStore } from '../../store/themes-store-provider';
import { usePresentationGenerator } from '../../hooks/usePresentationGenerator';
import { retry, RetryStrategies } from '../../utils/retry';
import { themeChangeEmitter } from '../../utils/theme-change-emitter';
import { useShallow } from 'zustand/react/shallow';

// Build queue to serialize presentation generation requests
interface BuildRequest {
  id: string;
  docName: string;
  doc: any;
  signal: AbortSignal;
  timestamp: number;
}

class BuildQueue {
  private queue: BuildRequest[] = [];
  private processing = false;
  private currentRequest: BuildRequest | null = null;

  add(request: BuildRequest): void {
    // Remove any existing requests for the same document
    this.queue = this.queue.filter((r) => r.docName !== request.docName);
    this.queue.push(request);
    this.process();
  }

  async process(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;

    this.processing = true;
    this.currentRequest = this.queue.shift()!;
  }

  complete(): void {
    this.currentRequest = null;
    this.processing = false;
    this.process();
  }

  getCurrentRequest(): BuildRequest | null {
    return this.currentRequest;
  }

  cancelAll(): void {
    this.queue = [];
    this.currentRequest = null;
    this.processing = false;
  }

  cancelByDocument(docName: string): void {
    this.queue = this.queue.filter((r) => r.docName !== docName);
    if (this.currentRequest?.docName === docName) {
      this.currentRequest = null;
      this.processing = false;
      this.process();
    }
  }
}

function EditorComponent() {
  const setOutput = useOutputStore((state) => state.setOutput);
  const saveDocumentDebounceWait = useSettingsStore(
    (state) => state.saveDocumentDebounceWait
  );
  const {
    openTabs,
    activeTab,
    setActiveTab,
    documents,
    buildErrors,
    setBuildError,
    documentTypes,
  } = useDocumentsStore(
    useShallow((state) => ({
      openTabs: state.openTabs,
      activeTab: state.activeTab,
      setActiveTab: state.setActiveTab,
      documents: state.documents,
      buildErrors: state.buildErrors,
      setBuildError: state.setBuildError,
      documentTypes: state.documentTypes,
    }))
  );
  const { customThemes, getAllThemeNames, getTheme } = useThemesStore(
    useShallow((state) => ({
      customThemes: state.customThemes,
      getAllThemeNames: state.getAllThemeNames,
      getTheme: state.getTheme,
    }))
  );
  const { generatePresentation, cancelGeneration } = usePresentationGenerator();

  // Refs to track ongoing operations and prevent race conditions
  const buildQueueRef = useRef<BuildQueue>(new BuildQueue());
  const buildAbortControllersRef = useRef<Map<string, AbortController>>(
    new Map()
  );
  const buildTimeoutsRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const lastBuildRequestIdRef = useRef<string>('');
  const documentVersionsRef = useRef<Map<string, number>>(new Map());

  // Get or create a document version number
  const getDocumentVersion = useCallback((docName: string) => {
    const currentVersion = documentVersionsRef.current.get(docName) || 0;
    const newVersion = currentVersion + 1;
    documentVersionsRef.current.set(docName, newVersion);
    return newVersion;
  }, []);

  // Build document with specific theme data (bypasses memoization)
  const buildDocumentWithThemes = useCallback(
    async (doc: any, themesData: { [key: string]: any }) => {
      if (!doc || !generatePresentation) {
        return;
      }

      // Cancel any existing build operation for this document
      const existingController = buildAbortControllersRef.current.get(doc.name);
      if (existingController) {
        existingController.abort();
        buildAbortControllersRef.current.delete(doc.name);
      }

      const abortController = new AbortController();
      const signal = abortController.signal;
      buildAbortControllersRef.current.set(doc.name, abortController);

      // Create build request
      const requestId = `${doc.name}-theme-${Date.now()}-${Math.random()}`;
      const version = getDocumentVersion(doc.name);
      lastBuildRequestIdRef.current = requestId;

      console.log('Editor: Starting theme-triggered build with fresh data', {
        docName: doc.name,
        requestId,
        freshThemeCount: Object.keys(themesData).length,
        version,
      });

      const buildRequest: BuildRequest = {
        id: requestId,
        docName: doc.name,
        doc,
        signal,
        timestamp: Date.now(),
      };

      // Process immediately (bypass queue for theme changes)
      await processBuildRequestWithThemes(buildRequest, version, themesData);
    },
    [generatePresentation, setOutput, getDocumentVersion]
  );

  // Process build request with specific theme data
  const processBuildRequestWithThemes = useCallback(
    async (
      request: BuildRequest,
      _version: number,
      themesData: { [key: string]: any }
    ) => {
      const { doc, signal, id } = request;

      setOutput({
        globalError: undefined,
        isGenerating: true,
        generationProgress: {
          stage: 'parsing',
          message: 'Rebuilding with updated theme...',
        },
      });

      const onProgress = (
        stage: 'parsing' | 'building' | 'rendering' | 'finalizing',
        message?: string
      ) => {
        if (signal.aborted || lastBuildRequestIdRef.current !== id) return;

        setOutput({
          isGenerating: true,
          generationProgress: { stage, message },
        });
      };

      try {
        console.log('Editor: Generating document with fresh themes', {
          docName: doc.name,
          themeNames: Object.keys(themesData),
          requestId: id,
        });

        const result = await generatePresentation(
          doc.name,
          doc.text,
          themesData,
          onProgress
        );

        if (signal.aborted || lastBuildRequestIdRef.current !== id) {
          console.log('Theme build cancelled for:', doc.name);
          return;
        }

        if (
          result &&
          typeof result === 'object' &&
          'name' in result &&
          'text' in result &&
          'blob' in result
        ) {
          console.log('Editor: Theme-triggered build completed', {
            docName: result.name,
            blobSize: (result.blob as Blob)?.size,
            timestamp: Date.now(),
            requestId: id,
          });

          setOutput({
            name: result.name as string,
            text: result.text as string,
            blob: result.blob as Blob,
            globalError: undefined,
            isGenerating: false,
            generationProgress: undefined,
            cacheStatus: (result as any).cacheStatus as
              | 'HIT'
              | 'MISS'
              | 'UNKNOWN'
              | undefined,
            cacheHitRate: (result as any).cacheHitRate as string | undefined,
            warnings: (result as any).warnings as any,
          });
          setBuildError(result.name as string, undefined);
        }
      } catch (error) {
        if (signal.aborted || lastBuildRequestIdRef.current !== id) {
          console.log('Theme build cancelled with error for:', doc.name);
          return;
        }

        const errorMessage =
          error instanceof Error ? error.message : String(error);
        console.error('Theme build error:', errorMessage);

        setOutput({
          globalError: `Theme rebuild failed: ${errorMessage}`,
          isGenerating: false,
          generationProgress: undefined,
        });
        setBuildError(doc.name, errorMessage);
      } finally {
        buildAbortControllersRef.current.delete(doc.name);
      }
    },
    [generatePresentation, setOutput, setBuildError]
  );

  // Prepare valid custom themes with deep comparison
  const customThemesContentHash = useMemo(() => {
    // Create a content hash of all themes to detect deep changes
    const themeData = Object.entries(customThemes).map(([key, theme]) => {
      // Handle lastModified that might be a string (from localStorage) or Date
      let lastModifiedTime = 0;
      if (theme.lastModified) {
        if (theme.lastModified instanceof Date) {
          lastModifiedTime = theme.lastModified.getTime();
        } else if (typeof theme.lastModified === 'string') {
          lastModifiedTime = new Date(theme.lastModified).getTime();
        }
      }

      return {
        key,
        name: theme.name,
        content: theme.content,
        valid: theme.valid,
        lastModified: lastModifiedTime,
      };
    });
    return JSON.stringify(themeData);
  }, [customThemes]);

  const validCustomThemes = useMemo(() => {
    const themes: { [key: string]: any } = {};
    Object.values(customThemes).forEach((theme) => {
      if (theme.valid && theme.parsed) {
        themes[theme.name] = theme.parsed;
      }
    });
    return themes;
  }, [customThemesContentHash]);

  // Helper function to get fresh theme data (bypasses memo)
  const getFreshThemeData = useCallback(() => {
    const freshThemes: { [key: string]: any } = {};
    const allThemeNames = getAllThemeNames();
    allThemeNames.forEach((name) => {
      const themeData = getTheme(name);
      if (themeData) {
        freshThemes[name] = themeData;
      }
    });
    return freshThemes;
  }, [getAllThemeNames, getTheme]);

  // Helper function to build a document with proper cancellation and retry
  const buildDocument = useCallback(
    async (doc: any, signal?: AbortSignal) => {
      if (!doc || !generatePresentation) {
        return;
      }

      // Cancel any existing build operation for this document
      const existingController = buildAbortControllersRef.current.get(doc.name);
      if (existingController) {
        existingController.abort();
        buildAbortControllersRef.current.delete(doc.name);
      }

      // Create new abort controller if not provided
      const abortController = signal ? null : new AbortController();
      const finalSignal = signal || abortController!.signal;
      if (abortController) {
        buildAbortControllersRef.current.set(doc.name, abortController);
      }

      // Create build request
      const requestId = `${doc.name}-${Date.now()}-${Math.random()}`;
      const version = getDocumentVersion(doc.name);
      lastBuildRequestIdRef.current = requestId;

      const buildRequest: BuildRequest = {
        id: requestId,
        docName: doc.name,
        doc,
        signal: finalSignal,
        timestamp: Date.now(),
      };

      // Add to queue
      buildQueueRef.current.add(buildRequest);

      // Process if this is the current request
      const currentRequest = buildQueueRef.current.getCurrentRequest();
      if (currentRequest?.id === requestId) {
        await processBuildRequest(currentRequest, version);
      }
    },
    [generatePresentation, setOutput, getDocumentVersion]
  );

  // Process a build request from the queue
  const processBuildRequest = useCallback(
    async (request: BuildRequest, version: number) => {
      const { doc, signal, id } = request;

      // Check if this is still the latest request
      if (lastBuildRequestIdRef.current !== id) {
        console.log('Skipping outdated build request for:', doc.name);
        buildQueueRef.current.complete();
        return;
      }

      setOutput({
        globalError: undefined,
        isGenerating: true,
        generationProgress: {
          stage: 'parsing',
          message: 'Validating JSON structure...',
        },
      });

      const onProgress = (
        stage: 'parsing' | 'building' | 'rendering' | 'finalizing',
        message?: string
      ) => {
        if (signal.aborted || lastBuildRequestIdRef.current !== id) return;

        // Check document version to ensure we're still building the latest
        const currentVersion = documentVersionsRef.current.get(doc.name) || 0;
        if (currentVersion !== version) {
          console.log('Document version changed, aborting build');
          signal.dispatchEvent(new Event('abort'));
          return;
        }

        setOutput({
          isGenerating: true,
          generationProgress: { stage, message },
        });
      };

      try {
        // Always get fresh theme data to ensure latest changes are applied
        const freshThemeData = getFreshThemeData();

        console.log('Editor: Using themes for document build', {
          docName: doc.name,
          freshThemeCount: Object.keys(freshThemeData).length,
          freshThemeNames: Object.keys(freshThemeData),
          memoizedCount: Object.keys(validCustomThemes).length,
          requestId: id,
        });

        // Retry logic for temporary failures
        const result = await retry(
          async () => {
            if (signal.aborted) throw new Error('Build cancelled');
            return await generatePresentation(
              doc.name,
              doc.text,
              freshThemeData,
              onProgress
            );
          },
          {
            maxRetries: 2,
            initialDelay: 500,
            shouldRetry: (error) => {
              // Don't retry on cancellation or syntax errors
              if (
                error.message.includes('cancelled') ||
                error.message.includes('JSON') ||
                error.message.includes('parse') ||
                error.message.includes('syntax')
              ) {
                return false;
              }
              // Retry on worker errors
              return RetryStrategies.combine(
                RetryStrategies.temporaryErrors,
                (e) =>
                  e.message.includes('Worker') || e.message.includes('Proxy')
              )(error);
            },
            onRetry: (error, attempt) => {
              console.log(
                `Retrying presentation generation (attempt ${attempt}):`,
                error.message
              );
              setOutput({
                isGenerating: true,
                generationProgress: {
                  stage: 'parsing',
                  message: `Retrying generation (attempt ${attempt})...`,
                },
              });
            },
            signal,
          }
        );

        if (signal.aborted || lastBuildRequestIdRef.current !== id) {
          console.log('Build cancelled for:', doc.name);
          return;
        }

        if (
          result &&
          typeof result === 'object' &&
          'name' in result &&
          'text' in result &&
          'blob' in result
        ) {
          console.log('Editor: Build completed', {
            docName: result.name,
            blobSize: (result.blob as Blob)?.size,
            timestamp: Date.now(),
            requestId: id,
            version,
          });

          setOutput({
            name: result.name as string,
            text: result.text as string,
            blob: result.blob as Blob,
            globalError: undefined,
            isGenerating: false,
            generationProgress: undefined,
            cacheStatus: (result as any).cacheStatus as
              | 'HIT'
              | 'MISS'
              | 'UNKNOWN'
              | undefined,
            cacheHitRate: (result as any).cacheHitRate as string | undefined,
            warnings: (result as any).warnings as any,
          });
          setBuildError(result.name as string, undefined);
        }
      } catch (error) {
        if (signal.aborted || lastBuildRequestIdRef.current !== id) {
          console.log('Build cancelled with error for:', doc.name);
          return;
        }

        const errorMessage =
          error instanceof Error ? error.message : String(error);

        setOutput({
          globalError: errorMessage,
          isGenerating: false,
          generationProgress: undefined,
        });

        setBuildError(doc.name, errorMessage);
      } finally {
        buildAbortControllersRef.current.delete(doc.name);
        buildQueueRef.current.complete();
      }
    },
    [generatePresentation, getFreshThemeData, setOutput, setBuildError]
  );

  // Track the last viewed document for theme updates
  const lastViewedDocumentRef = useRef<string | null>(null);

  // re-build on active tab change or any document change
  useEffect(() => {
    console.log('Editor: Document rebuild effect triggered', {
      activeTab,
      customThemesContentHash: customThemesContentHash.substring(0, 50) + '...',
      customThemesCount: Object.keys(customThemes).length,
    });

    const activeFile = documents.find((doc) => doc.name === activeTab);
    const docType = documentTypes[activeTab] || 'application/json+report';

    // Track last viewed document
    if (docType === 'application/json+report' && activeFile) {
      lastViewedDocumentRef.current = activeTab;
    }

    // Clear any pending build timeout for this document
    const existingTimeout = buildTimeoutsRef.current.get(activeTab);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
      buildTimeoutsRef.current.delete(activeTab);
    }

    if (activeFile && docType === 'application/json+report') {
      // Use adaptive debounce based on document size
      const docSize = activeFile.text.length;
      const debounceTime = docSize > 10000 ? 300 : docSize > 5000 ? 200 : 100;

      // Cancel any builds for other documents
      buildAbortControllersRef.current.forEach((controller, docName) => {
        if (docName !== activeTab) {
          controller.abort();
          buildAbortControllersRef.current.delete(docName);
        }
      });

      // Debounce the build to avoid rapid rebuilds
      const timeout = setTimeout(() => {
        console.log('Editor: Triggering document build after debounce', {
          docName: activeFile.name,
          debounceTime,
          customThemesCount: Object.keys(customThemes).length,
          customThemesContentHash:
            customThemesContentHash.substring(0, 50) + '...',
        });
        buildTimeoutsRef.current.delete(activeTab);

        // Force new version when themes change to ensure rebuild
        getDocumentVersion(activeFile.name);
        buildDocument(activeFile);
      }, debounceTime);

      buildTimeoutsRef.current.set(activeTab, timeout);
    } else if (activeFile && docType === 'application/json+theme') {
      // Clear only error and generation status, preserve last document info
      setOutput({
        globalError: undefined,
        blob: undefined,
        isGenerating: false,
      });
      // Cancel any ongoing generation
      cancelGeneration();

      // If themes changed and we have a last viewed document, rebuild it
      if (lastViewedDocumentRef.current && customThemesContentHash) {
        const lastDoc = documents.find(
          (d) => d.name === lastViewedDocumentRef.current
        );
        if (
          lastDoc &&
          documentTypes[lastDoc.name] === 'application/json+report'
        ) {
          console.log(
            'Editor: Theme changed while viewing theme tab, rebuilding last document',
            {
              lastDocName: lastDoc.name,
              activeThemeTab: activeTab,
            }
          );

          // Clear any existing rebuild timeout for the last document
          const existingLastDocTimeout = buildTimeoutsRef.current.get(
            lastDoc.name
          );
          if (existingLastDocTimeout) {
            clearTimeout(existingLastDocTimeout);
            buildTimeoutsRef.current.delete(lastDoc.name);
          }

          // Debounce the rebuild
          const timeout = setTimeout(() => {
            console.log(
              'Editor: Rebuilding last viewed document after theme change',
              {
                docName: lastDoc.name,
                fromThemeTab: activeTab,
              }
            );
            buildTimeoutsRef.current.delete(lastDoc.name);
            getDocumentVersion(lastDoc.name);
            buildDocument(lastDoc);
          }, 500); // Use longer delay for theme changes

          buildTimeoutsRef.current.set(lastDoc.name, timeout);
        }
      }
    }

    // Cleanup function to cancel pending operations
    return () => {
      const timeout = buildTimeoutsRef.current.get(activeTab);
      if (timeout) {
        clearTimeout(timeout);
        buildTimeoutsRef.current.delete(activeTab);
      }
    };
  }, [
    documents,
    activeTab,
    setOutput,
    documentTypes,
    buildDocument,
    cancelGeneration,
    customThemesContentHash,
  ]);

  // Track which documents use which themes
  const documentThemeDependencies = useMemo(() => {
    const deps = new Map<string, string>();

    documents.forEach((doc) => {
      if (documentTypes[doc.name] === 'application/json+report') {
        try {
          const parsed = JSON.parse(doc.text);
          if (parsed.children && Array.isArray(parsed.children)) {
            for (const component of parsed.children) {
              if (component.name === 'report' && component.props?.theme) {
                const themeName = component.props.theme;
                // Check if this theme exists in customThemes
                const themeExists = Object.values(customThemes).some(
                  (t) => t.name === themeName && t.valid
                );
                if (themeExists) {
                  deps.set(doc.name, themeName);
                  break;
                }
              }
            }
          }
        } catch {
          // Ignore parse errors
        }
      }
    });

    return deps;
  }, [documents, documentTypes, customThemes]);

  // Listen for theme change events and force immediate rebuild
  useEffect(() => {
    console.log('Editor: Setting up theme change listener', {
      documentCount: documents.length,
      dependencyCount: documentThemeDependencies.size,
      dependencies: Array.from(documentThemeDependencies.entries()),
      customThemes: Object.entries(customThemes).map(([key, theme]) => ({
        key,
        name: theme.name,
        valid: theme.valid,
      })),
    });

    const unsubscribe = themeChangeEmitter.onThemeChange((event) => {
      console.log('Editor: Theme change detected', {
        event,
        dependencies: Array.from(documentThemeDependencies.entries()),
        activeTab,
        customThemes: Object.entries(customThemes).map(([key, theme]) => ({
          key,
          name: theme.name,
          valid: theme.valid,
        })),
      });

      // Find all documents that use this theme
      const documentsUsingTheme: any[] = [];

      documentThemeDependencies.forEach((themeName, docName) => {
        if (themeName === event.themeName) {
          const doc = documents.find((d) => d.name === docName);
          if (doc) {
            documentsUsingTheme.push(doc);
          }
        }
      });

      console.log('Editor: Documents using changed theme', {
        themeName: event.themeName,
        documentCount: documentsUsingTheme.length,
        documentNames: documentsUsingTheme.map((d) => d.name),
      });

      if (documentsUsingTheme.length === 0) {
        console.log('Editor: No documents use this theme, skipping rebuild');
        return;
      }

      // Force immediate rebuild to ensure fresh theme data is used
      // Use longer delay to ensure theme store has updated
      // Add extra delay to account for debouncing in theme updates
      const THEME_UPDATE_DELAY = 600;

      // Only rebuild the currently active document
      const activeDocument = documentsUsingTheme.find(
        (doc) => doc.name === activeTab
      );

      if (!activeDocument) {
        console.log(
          'Editor: Changed theme is not used by active document, skipping rebuild'
        );
        return;
      }

      console.log('Editor: Rebuilding only active document', {
        activeDocName: activeDocument.name,
        themeName: event.themeName,
        totalDocumentsUsingTheme: documentsUsingTheme.length,
      });

      // Clear any existing rebuild timeouts for the active document
      ['theme-event', 'backup', activeDocument.name].forEach((prefix) => {
        const timeoutKey = `${prefix}-${activeDocument.name}`;
        const existingTimeout = buildTimeoutsRef.current.get(timeoutKey);
        if (existingTimeout) {
          clearTimeout(existingTimeout);
          buildTimeoutsRef.current.delete(timeoutKey);
        }
      });

      // Cancel any ongoing builds for the active document
      const existingController = buildAbortControllersRef.current.get(
        activeDocument.name
      );
      if (existingController) {
        existingController.abort();
        buildAbortControllersRef.current.delete(activeDocument.name);
      }

      const themeTimeoutKey = `theme-event-${activeDocument.name}`;
      const timeout = setTimeout(() => {
        buildTimeoutsRef.current.delete(themeTimeoutKey);
        console.log(
          'Editor: Force rebuilding active document due to theme change',
          {
            docName: activeDocument.name,
            themeName: event.themeName,
            timestamp: Date.now(),
          }
        );

        // Get fresh theme data directly from store to bypass stale memoization
        const freshThemes: { [key: string]: any } = {};
        const allThemeNames = getAllThemeNames();
        allThemeNames.forEach((name) => {
          const themeData = getTheme(name);
          if (themeData) {
            freshThemes[name] = themeData;
          }
        });

        console.log('Editor: Using fresh theme data for rebuild', {
          freshThemeCount: Object.keys(freshThemes).length,
          freshThemeNames: Object.keys(freshThemes),
          memoizedCount: Object.keys(validCustomThemes).length,
        });

        // Force a new document version and rebuild with fresh themes
        getDocumentVersion(activeDocument.name);
        buildDocumentWithThemes(activeDocument, freshThemes);
      }, THEME_UPDATE_DELAY);

      buildTimeoutsRef.current.set(themeTimeoutKey, timeout);
    });

    return unsubscribe;
  }, [
    documentThemeDependencies,
    documents,
    buildDocument,
    getDocumentVersion,
    activeTab,
    getAllThemeNames,
    getTheme,
    buildDocumentWithThemes,
    validCustomThemes,
  ]);

  // Remove backup mechanism - we'll rely on the theme change events only
  // This prevents multiple rebuilds for the same theme change

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Cancel all pending builds
      buildAbortControllersRef.current.forEach((controller) =>
        controller.abort()
      );
      buildAbortControllersRef.current.clear();

      // Clear all timeouts
      buildTimeoutsRef.current.forEach((timeout) => clearTimeout(timeout));
      buildTimeoutsRef.current.clear();

      // Cancel any ongoing generation
      cancelGeneration();

      // Clear the build queue
      buildQueueRef.current.cancelAll();
    };
  }, [cancelGeneration]);

  if (!openTabs.length) {
    return (
      <div className="flex flex-col text-muted-foreground h-full items-center justify-center">
        {!documents?.length ? 'Create a new document...' : 'Open a document...'}
      </div>
    );
  }

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full">
      {/* Tabs header removed to gain vertical space */}
      <EditorTabsContentMemoized
        openTabs={openTabs}
        documents={documents}
        buildErrors={buildErrors}
        saveDocumentDebounceWait={saveDocumentDebounceWait}
      />
    </Tabs>
  );
}

// Export memoized version of Editor component
export const Editor = memo(EditorComponent);
