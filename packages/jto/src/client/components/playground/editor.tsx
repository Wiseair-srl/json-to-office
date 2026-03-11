import { useEffect, useCallback, useRef, useMemo, memo, useContext } from 'react';
import { EditorTabsContentMemoized } from './editor-tabs-content';
import { Tabs } from '../ui/tabs';
import { useDocumentsStore, DocumentsStoreContext } from '../../store/documents-store-provider';
import { useOutputStore, OutputStoreContext } from '../../store/output-store-provider';
import { useSettingsStore } from '../../store/settings-store-provider';
import { useEditorRefsStore } from '../../store/editor-refs-store';
import { useThemesStore } from '../../store/themes-store-provider';
import { usePresentationGenerator } from '../../hooks/usePresentationGenerator';
import { retry, RetryStrategies } from '../../utils/retry';
import { themeChangeEmitter } from '../../utils/theme-change-emitter';
import { useShallow } from 'zustand/react/shallow';

interface BuildRequest {
  id: string;
  docName: string;
  doc: any;
  signal: AbortSignal;
  timestamp: number;
}

function EditorComponent() {
  const setOutput = useOutputStore((state) => state.setOutput);
  const outputStore = useContext(OutputStoreContext)!;
  const documentsStore = useContext(DocumentsStoreContext)!;
  const saveDocumentDebounceWait = useSettingsStore(
    (state) => state.saveDocumentDebounceWait
  );
  const autoReload = useSettingsStore((state) => state.autoReload);
  const renderingLibrary = useSettingsStore((state) => state.renderingLibrary);
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
          setOutput({ isGenerating: false, generationProgress: undefined });
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
            isPreviewStale: false,
            generationProgress: undefined,
            lastBuiltSequence: outputStore.getState().editSequence,
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
          setOutput({ isGenerating: false, generationProgress: undefined });
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
    [generatePresentation, setOutput, setBuildError, outputStore]
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

      await processBuildRequest(buildRequest, version);
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
        setOutput({ isGenerating: false, generationProgress: undefined });
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
          setOutput({ isGenerating: false, generationProgress: undefined });
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
            isPreviewStale: false,
            generationProgress: undefined,
            lastBuiltSequence: outputStore.getState().editSequence,
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
          setOutput({ isGenerating: false, generationProgress: undefined });
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
      }
    },
    [generatePresentation, getFreshThemeData, setOutput, setBuildError, outputStore]
  );

  // Track the last viewed document for theme updates
  const lastViewedDocumentRef = useRef<string | null>(null);


  // re-build on active tab change or any document change
  useEffect(() => {
    console.log('Editor: Document rebuild effect triggered', {
      activeTab,
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
      // Skip auto-build when auto-generation is disabled;
      // also don't clobber an in-progress build (e.g. triggered by Run button)
      if (!autoReload || renderingLibrary !== 'docxjs') {
        if (!outputStore.getState().isGenerating) {
          setOutput({ isPreviewStale: true });
        }
      } else {
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
          });
          buildTimeoutsRef.current.delete(activeTab);

          // Force new version when themes change to ensure rebuild
          getDocumentVersion(activeFile.name);
          buildDocument(activeFile);
        }, debounceTime);

        buildTimeoutsRef.current.set(activeTab, timeout);
      }
    } else if (activeFile && docType === 'application/json+theme') {
      // Theme tab active — no document preview to build.
      // Don't clear blob: preserve the last document preview in the background.
      cancelGeneration();
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
    autoReload,
    renderingLibrary,
  ]);

  // Track which documents use which themes (only parse the active doc to avoid O(n) JSON.parse)
  const documentThemeDependencies = useMemo(() => {
    const deps = new Map<string, string>();
    const activeDoc = documents.find((d) => d.name === activeTab);
    if (activeDoc && documentTypes[activeDoc.name] === 'application/json+report') {
      try {
        const parsed = JSON.parse(activeDoc.text);
        const themeName = parsed.props?.theme;
        if (typeof themeName === 'string') {
          const themeExists = Object.values(customThemes).some(
            (t) => t.name === themeName && t.valid
          );
          if (themeExists) {
            deps.set(activeDoc.name, themeName);
          }
        }
      } catch {
        // Ignore parse errors
      }
    }
    return deps;
  }, [activeTab, documents, documentTypes, customThemes]);

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
        // Active tab is a theme or unrelated doc — mark stale if a dependent doc exists
        if (documentsUsingTheme.length > 0) {
          setOutput({ isPreviewStale: true });
        }
        return;
      }

      // Skip auto-build when auto-generation is disabled
      if (!autoReload || renderingLibrary !== 'docxjs') {
        if (!outputStore.getState().isGenerating) {
          setOutput({ isPreviewStale: true });
        }
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
    autoReload,
    renderingLibrary,
    setOutput,
  ]);

  // Flush debounces and immediately build — triggered by Run button via custom event
  // Debounced at 150ms to coalesce rapid clicks
  const flushBuildTimerRef = useRef<NodeJS.Timeout | null>(null);
  // Stable refs so the event handler never goes stale and doesn't need
  // reactive deps that would cause cleanup to cancel the pending timeout
  const buildDocumentRef = useRef(buildDocument);
  useEffect(() => { buildDocumentRef.current = buildDocument; });
  const getDocumentVersionRef = useRef(getDocumentVersion);
  useEffect(() => { getDocumentVersionRef.current = getDocumentVersion; });

  useEffect(() => {
    const handler = () => {
      // Mark generating early so the rebuild effect (triggered by saveDocument
      // below) doesn't clobber this build with isPreviewStale
      setOutput({ isGenerating: true });

      // 1. Flush Monaco debounce: read live text, save to store immediately
      const editorRef = useEditorRefsStore.getState().getActiveEditor();
      if (editorRef) {
        const liveText = editorRef.editor.getValue();
        // Save imperatively via store to avoid reactive deps on `documents`
        documentsStore.getState().saveDocument(editorRef.documentName, liveText);
      }

      // 2. Cancel any pending build timeout for active doc
      const currentTab = documentsStore.getState().activeTab;
      const timeout = buildTimeoutsRef.current.get(currentTab);
      if (timeout) {
        clearTimeout(timeout);
        buildTimeoutsRef.current.delete(currentTab);
      }

      // 3. Debounce the actual build to coalesce rapid Run clicks
      if (flushBuildTimerRef.current) {
        clearTimeout(flushBuildTimerRef.current);
      }
      flushBuildTimerRef.current = setTimeout(() => {
        flushBuildTimerRef.current = null;
        const { documents: docs, activeTab: tab, documentTypes: dtypes } = documentsStore.getState();

        // Determine target: if active tab is a theme, build the last-viewed document instead
        let targetName = tab;
        const tabType = dtypes[tab] || 'application/json+report';
        if (tabType === 'application/json+theme') {
          if (lastViewedDocumentRef.current) {
            targetName = lastViewedDocumentRef.current;
          } else {
            // No document was viewed yet — nothing to build
            setOutput({ isGenerating: false });
            return;
          }
        }

        const freshDoc = docs.find((d) => d.name === targetName);
        if (freshDoc) {
          // If the document tab has an open editor, use its live text
          const ref = useEditorRefsStore.getState().getEditor(targetName);
          const doc = ref
            ? { ...freshDoc, text: ref.editor.getValue() }
            : freshDoc;
          getDocumentVersionRef.current(doc.name);
          buildDocumentRef.current(doc);
        } else {
          setOutput({ isGenerating: false });
        }
      }, 150);
    };

    window.addEventListener('preview:flushAndBuild', handler);
    return () => {
      window.removeEventListener('preview:flushAndBuild', handler);
      if (flushBuildTimerRef.current) {
        clearTimeout(flushBuildTimerRef.current);
      }
    };
  }, [setOutput, documentsStore]);

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
