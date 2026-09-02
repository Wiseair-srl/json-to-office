import {
  useEffect,
  useCallback,
  useRef,
  useMemo,
  memo,
  useContext,
} from 'react';
import { EditorTabsContentMemoized } from './editor-tabs-content';
import { Tabs } from '../ui/tabs';
import {
  useDocumentsStore,
  DocumentsStoreContext,
} from '../../store/documents-store-provider';
import {
  useOutputStore,
  OutputStoreContext,
} from '../../store/output-store-provider';
import { useSettingsStore } from '../../store/settings-store-provider';
import { useEditorRefsStore } from '../../store/editor-refs-store';
import {
  useThemesStore,
  ThemesStoreContext,
} from '../../store/themes-store-provider';
import {
  QualityGateFailedError,
  usePresentationGenerator,
} from '../../hooks/usePresentationGenerator';
import { useQualityAnalysis } from '../../hooks/useQualityAnalysis';
import { FORMAT } from '../../lib/env';
import {
  buildQualityOptions,
  storedProfileId,
} from '../../lib/quality-profiles';
import {
  isStaleQualityTicket,
  nextQualityTicket,
} from '../../lib/quality-sequence';
import {
  countBySeverity,
  findingsFromAnalysis,
  splitQualityWarnings,
  type GenerationWarningLike,
} from '../../lib/quality-findings';
import type { GenerationWarning, QualityState } from '../../store/output-store';
import { retry, RetryStrategies } from '../../utils/retry';
import { themeChangeEmitter } from '../../utils/theme-change-emitter';
import { expandForServer } from '../../lib/plugins/expand-for-server';
import { compileQueue } from '../../lib/plugins/compile-queue';
import { BROWSER_PLUGINS_CHANGED_EVENT } from '../../hooks/useBrowserPluginsSync';
import {
  buildThemeSpecimen,
  isSampleOutputName,
  sampleOutputName,
} from '../../lib/theme-editor/specimen';
import { getThemeName } from '../../lib/theme-validation';
import { useShallow } from 'zustand/react/shallow';

interface BuildRequest {
  id: string;
  docName: string;
  doc: any;
  signal: AbortSignal;
  timestamp: number;
  /** Ordering ticket for the quality slice; see lib/quality-sequence.ts. */
  qualityTicket: number;
}

function EditorComponent() {
  const setOutput = useOutputStore((state) => state.setOutput);
  const outputStore = useContext(OutputStoreContext)!;
  const documentsStore = useContext(DocumentsStoreContext)!;
  const themesStore = useContext(ThemesStoreContext)!;
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
  const { customThemes } = useThemesStore(
    useShallow((state) => ({ customThemes: state.customThemes }))
  );
  const { generatePresentation, cancelGeneration } = usePresentationGenerator();
  const qualityProfileIds = useSettingsStore(
    (state) => state.qualityProfileIds
  );
  const qualityProfileId = storedProfileId(qualityProfileIds);
  const qualityGate = useSettingsStore((state) => state.qualityGate);
  const qualityPolicyText = useSettingsStore(
    (state) => state.qualityPolicies?.[FORMAT]
  );
  const qualityOptions = useMemo(
    () => buildQualityOptions(qualityProfileId, qualityGate, qualityPolicyText),
    [qualityProfileId, qualityGate, qualityPolicyText]
  );
  const { analyze: analyzeQuality, cancel: cancelQualityAnalysis } =
    useQualityAnalysis();

  // Refs to track ongoing operations and prevent race conditions
  const buildAbortControllersRef = useRef<Map<string, AbortController>>(
    new Map()
  );
  const buildTimeoutsRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  // Debounce timer for Run-button builds (150ms to coalesce rapid clicks).
  const flushBuildTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastBuildRequestIdRef = useRef<string>('');
  const documentVersionsRef = useRef<Map<string, number>>(new Map());

  // User-initiated cancel from the loading UI: invalidate the current request
  // id first (so both build paths take their quiet "cancelled" exit instead of
  // surfacing a global error), then abort the controllers and the in-flight
  // fetch.
  const cancelActiveBuild = useCallback(() => {
    lastBuildRequestIdRef.current = `cancelled-${Date.now()}`;
    // Also drop queued debounced builds — without this, a pending auto-build
    // timer could start a new generation right after the user cancelled.
    for (const timeout of buildTimeoutsRef.current.values()) {
      clearTimeout(timeout);
    }
    buildTimeoutsRef.current.clear();
    if (flushBuildTimerRef.current) {
      clearTimeout(flushBuildTimerRef.current);
      flushBuildTimerRef.current = null;
    }
    for (const controller of buildAbortControllersRef.current.values()) {
      controller.abort();
    }
    buildAbortControllersRef.current.clear();
    cancelGeneration();
    setOutput({
      isGenerating: false,
      generationProgress: undefined,
      generationStartedAt: undefined,
    });
  }, [cancelGeneration, setOutput]);

  useEffect(() => {
    setOutput({ cancelGeneration: cancelActiveBuild });
  }, [cancelActiveBuild, setOutput]);

  // Get or create a document version number
  const getDocumentVersion = useCallback((docName: string) => {
    const currentVersion = documentVersionsRef.current.get(docName) || 0;
    const newVersion = currentVersion + 1;
    documentVersionsRef.current.set(docName, newVersion);
    return newVersion;
  }, []);

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
    const { customThemes } = themesStore.getState();
    Object.values(customThemes).forEach((theme) => {
      if (theme.valid && theme.parsed) {
        freshThemes[theme.name] = theme.parsed;
      }
    });
    return freshThemes;
  }, [themesStore]);

  // Helper function to build a document with proper cancellation and retry
  const buildDocument = useCallback(
    async (
      doc: any,
      signal?: AbortSignal,
      options?: { bypassCache?: boolean }
    ) => {
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
        // Claimed now, not on completion: a long build must not overwrite the
        // live analysis of an edit made while it was running.
        qualityTicket: nextQualityTicket(),
      };

      await processBuildRequestRef.current(buildRequest, version, options);
    },
    [generatePresentation, setOutput, getDocumentVersion]
  );

  // Process a build request from the queue
  const processBuildRequest = useCallback(
    async (
      request: BuildRequest,
      version: number,
      options?: { bypassCache?: boolean }
    ) => {
      const { doc, signal, id, qualityTicket } = request;
      // A build's findings describe the text it was handed. Anything newer in
      // the store was computed against text the editor actually holds now.
      const qualityIfCurrent = (next: QualityState) =>
        isStaleQualityTicket(outputStore.getState().quality, qualityTicket)
          ? {}
          : { quality: next };

      // Check if this is still the latest request
      if (lastBuildRequestIdRef.current !== id) {
        console.log('Skipping outdated build request for:', doc.name);
        setOutput({
          isGenerating: false,
          generationProgress: undefined,
          generationStartedAt: undefined,
        });
        return;
      }

      setOutput({
        globalError: undefined,
        isGenerating: true,
        generationStartedAt: Date.now(),
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

        // Browser plugins are expanded here, before the document leaves the
        // page: the server only ever sees standard components. Outside the
        // retry below, because a plugin that throws will throw again.
        onProgress('parsing', 'Expanding plugins...');
        const expansion = await expandForServer(doc.text, {
          customThemes: freshThemeData,
          signal,
        });
        // A document build supersedes a theme sample as the thing Run refreshes.
        if (!isSampleOutputName(doc.name)) lastSampleRef.current = null;
        if (signal.aborted || lastBuildRequestIdRef.current !== id) {
          setOutput({
            isGenerating: false,
            generationProgress: undefined,
            generationStartedAt: undefined,
          });
          return;
        }

        // Retry logic for temporary failures
        const result = await retry(
          async () => {
            if (signal.aborted) throw new Error('Build cancelled');
            return await generatePresentation(
              doc.name,
              expansion.text,
              freshThemeData,
              onProgress,
              {
                ...options,
                ...(qualityOptions ? { quality: qualityOptions } : {}),
              }
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
          setOutput({
            isGenerating: false,
            generationProgress: undefined,
            generationStartedAt: undefined,
          });
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

          // Quality findings arrive flattened into the same warnings array
          // as component warnings. Left there they are counted as warnings
          // whatever their real severity, which is how a stock deck's two
          // hundred advisory infos became a warning-coloured bar.
          const { findings, others } = splitQualityWarnings(
            (result as any).warnings as
              | GenerationWarningLike[]
              | null
              | undefined
          );

          setOutput({
            name: result.name as string,
            text: result.text as string,
            blob: result.blob as Blob,
            renderer: result.renderer as string | undefined,
            globalError: undefined,
            isGenerating: false,
            isPreviewStale: false,
            generationProgress: undefined,
            generationStartedAt: undefined,
            lastBuiltSequence: outputStore.getState().editSequence,
            cacheStatus: (result as any).cacheStatus as
              | 'HIT'
              | 'MISS'
              | 'UNKNOWN'
              | undefined,
            cacheHitRate: (result as any).cacheHitRate as string | undefined,
            // Plugin warnings first: they were raised by the author's own code
            // and read above whatever the renderer then had to say.
            warnings: [...expansion.warnings, ...others] as GenerationWarning[],
            ...qualityIfCurrent({
              findings,
              counts: countBySeverity(findings),
              // The generate response does not name the profile it ran, so
              // only an explicit choice is reported; a blank label is honest
              // about the server having picked the format's default.
              ...(qualityProfileId ? { profileId: qualityProfileId } : {}),
              documentName: doc.name,
              seq: qualityTicket,
              source: 'generate',
              analyzedAt: Date.now(),
            }),
          });
          setBuildError(result.name as string, undefined);
        }
      } catch (error) {
        if (signal.aborted || lastBuildRequestIdRef.current !== id) {
          console.log('Build cancelled with error for:', doc.name);
          setOutput({
            isGenerating: false,
            generationProgress: undefined,
            generationStartedAt: undefined,
          });
          return;
        }

        const errorMessage =
          error instanceof Error ? error.message : String(error);

        // A gate rejection is the only failure that says something about the
        // document rather than about the request, and it ships the findings
        // that caused it — so the panel names them instead of leaving the
        // author with "blocked" and nothing to act on.
        const gateFindings =
          error instanceof QualityGateFailedError
            ? findingsFromAnalysis(error.quality)
            : null;

        setOutput({
          globalError: errorMessage,
          isGenerating: false,
          generationProgress: undefined,
          generationStartedAt: undefined,
          ...(gateFindings
            ? qualityIfCurrent({
                findings: gateFindings,
                counts: countBySeverity(gateFindings),
                ...(qualityProfileId ? { profileId: qualityProfileId } : {}),
                documentName: doc.name,
                seq: qualityTicket,
                blocked: true,
                source: 'generate' as const,
                analyzedAt: Date.now(),
                gateError: errorMessage,
              })
            : {}),
        });

        setBuildError(doc.name, errorMessage);
      } finally {
        buildAbortControllersRef.current.delete(doc.name);
      }
    },
    [
      generatePresentation,
      getFreshThemeData,
      qualityOptions,
      qualityProfileId,
      setOutput,
      setBuildError,
      outputStore,
    ]
  );
  const processBuildRequestRef = useRef(processBuildRequest);
  useEffect(() => {
    processBuildRequestRef.current = processBuildRequest;
  });

  // Track the last viewed document for theme updates
  const lastViewedDocumentRef = useRef<string | null>(null);
  // The theme whose sample is on screen, if a sample is what was last built.
  const lastSampleRef = useRef<{ themeDocName: string } | null>(null);

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
      // Editing marks the preview stale rather than rebuilding: a build costs
      // a LibreOffice conversion, so it waits for Run. Do not clobber a build
      // already in flight (e.g. one the Run button started).
      if (!outputStore.getState().isGenerating) {
        setOutput({ isPreviewStale: true });
      }
    } else if (activeFile && docType !== 'application/json+report') {
      // Theme or plugin tab active — no document preview to build.
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
  ]);

  // Refresh the quality findings as the document settles, so the panel tracks
  // the editor instead of only the last build. `analyze` debounces and aborts
  // its own in-flight request, so a stale analysis can never land on top of a
  // newer one; returning `cancel` drops the pending work on unmount and on a
  // document switch.
  useEffect(() => {
    const activeFile = documents.find((doc) => doc.name === activeTab);
    const docType = documentTypes[activeTab] || 'application/json+report';
    if (!activeFile || docType !== 'application/json+report') {
      // A theme has no document findings of its own, and an analysis started
      // for the previous tab would report them under this one. Clearing rather
      // than only cancelling matters because nothing else ever will: without
      // it the previous document's findings stay on screen, and actionable,
      // for as long as a theme tab is open.
      cancelQualityAnalysis();
      setOutput({ quality: null });
      return;
    }
    analyzeQuality(activeTab, activeFile.text);
    return cancelQualityAnalysis;
  }, [
    activeTab,
    analyzeQuality,
    cancelQualityAnalysis,
    documents,
    documentTypes,
    setOutput,
  ]);

  // Track which documents use which themes (only parse the active doc to avoid O(n) JSON.parse)
  const documentThemeDependencies = useMemo(() => {
    const deps = new Map<string, string>();
    const activeDoc = documents.find((d) => d.name === activeTab);
    if (
      activeDoc &&
      documentTypes[activeDoc.name] === 'application/json+report'
    ) {
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

      // A theme change invalidates the preview of every document using it;
      // rebuilding is the author’s call, as it is for a document edit.
      if (!outputStore.getState().isGenerating) {
        setOutput({ isPreviewStale: true });
      }
    });

    return unsubscribe;
  }, [
    documentThemeDependencies,
    documents,
    buildDocument,
    getDocumentVersion,
    activeTab,
    setOutput,
  ]);

  // Flush debounces and immediately build — triggered by Run button via custom event
  // Debounced at 150ms to coalesce rapid clicks
  // Stable refs so the event handler never goes stale and doesn't need
  // reactive deps that would cause cleanup to cancel the pending timeout
  const buildDocumentRef = useRef(buildDocument);
  useEffect(() => {
    buildDocumentRef.current = buildDocument;
  });
  const getDocumentVersionRef = useRef(getDocumentVersion);
  useEffect(() => {
    getDocumentVersionRef.current = getDocumentVersion;
  });

  useEffect(() => {
    const handler = () => {
      // Mark generating early so the rebuild effect (triggered by saveDocument
      // below) doesn't clobber this build with isPreviewStale
      setOutput({ isGenerating: true });

      // 1. Flush Monaco debounce: read live text, save to store immediately
      let themeDirty = false;
      const editorRef = useEditorRefsStore.getState().getActiveEditor();
      if (editorRef) {
        // Don't flush if a pending diff is active — editor may be disposed
        const hasPendingDiff =
          documentsStore.getState().pendingDiffs[editorRef.documentName];
        if (!hasPendingDiff) {
          const liveText = editorRef.toStorageValue(
            editorRef.editor.getValue()
          );
          documentsStore
            .getState()
            .saveDocument(editorRef.documentName, liveText);
        }
      }

      // Flush all open theme editors whose live text differs from the
      // themes store so the build always uses up-to-date theme data.
      const { documents: allDocs, documentTypes: allDtypes } =
        documentsStore.getState();
      for (const doc of allDocs) {
        if (allDtypes[doc.name] === 'application/json+theme') {
          const ref = useEditorRefsStore.getState().getEditor(doc.name);
          if (ref) {
            const liveText = ref.toStorageValue(ref.editor.getValue());
            const existing = themesStore.getState().customThemes[doc.name];
            if (!existing || existing.content !== liveText) {
              themesStore.getState().updateTheme(doc.name, liveText);
              themeDirty = true;
            }
          }
        } else if (allDtypes[doc.name] === 'application/typescript+plugin') {
          // A plugin edited a moment ago is still behind its save debounce
          // and its compile debounce; the build must see what is on screen.
          const ref = useEditorRefsStore.getState().getEditor(doc.name);
          if (ref) {
            ref.flushPendingSave?.();
            const liveText = ref.toStorageValue(ref.editor.getValue());
            if (liveText !== doc.text) {
              documentsStore.getState().saveDocument(doc.name, liveText);
            }
          }
        }
      }
      // Whatever compile the edits above queued starts now rather than after
      // its debounce; the build below waits for the queue to drain.
      compileQueue.flush();

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
      flushBuildTimerRef.current = setTimeout(async () => {
        flushBuildTimerRef.current = null;
        // Plugins that were just edited are compiling; a build that ran now
        // would expand with the previous compiled code.
        await compileQueue.whenIdle();
        const {
          documents: docs,
          activeTab: tab,
          documentTypes: dtypes,
        } = documentsStore.getState();

        // Determine target: if active tab is a theme or a plugin, build the
        // last-viewed document instead — unless what is on screen is this
        // theme's sample, in which case Run refreshes the sample.
        let targetName = tab;
        const tabType = dtypes[tab] || 'application/json+report';
        if (tabType !== 'application/json+report') {
          const sample = lastSampleRef.current;
          if (
            sample &&
            tabType === 'application/json+theme' &&
            sample.themeDocName === tab
          ) {
            buildSampleRef.current(tab);
            return;
          }
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
          // If a pending diff exists (AI suggestion), preview the modified version
          const pending = documentsStore.getState().pendingDiffs[targetName];
          const ref = useEditorRefsStore.getState().getEditor(targetName);
          const doc = pending
            ? { ...freshDoc, text: pending.modified }
            : ref
              ? { ...freshDoc, text: ref.toStorageValue(ref.editor.getValue()) }
              : freshDoc;
          getDocumentVersionRef.current(doc.name);
          // Bypass cache only when a theme was updated during this flush
          buildDocumentRef.current(
            doc,
            undefined,
            themeDirty ? { bypassCache: true } : undefined
          );
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
  }, [setOutput, documentsStore, themesStore]);

  // A theme's sample: a document the theme editor builds on demand rather
  // than a file in the workspace. Same build path as Run, cache bypassed since
  // the theme it names was just edited. The sample is remembered per theme
  // file so a later Run on that tab refreshes it instead of swapping the
  // preview back to the last document.
  const buildSample = useCallback(
    (themeDocName: string) => {
      const { documents: docs } = documentsStore.getState();
      const themeDoc = docs.find((d) => d.name === themeDocName);
      if (!themeDoc) {
        setOutput({ isGenerating: false });
        return;
      }
      let parsed: Record<string, unknown> | undefined;
      let themeName: string | null = null;
      let parseError: string | null = null;
      try {
        parsed = JSON.parse(themeDoc.text);
        themeName = getThemeName(parsed);
      } catch (error) {
        // A syntax error and a missing name are different repairs; saying
        // "no name" against broken JSON sends the author to the wrong line.
        parseError = error instanceof Error ? error.message : 'Invalid JSON';
      }
      if (!themeName) {
        setOutput({
          isGenerating: false,
          globalError: parseError
            ? `The theme is not valid JSON: ${parseError}`
            : 'The theme has no name',
        });
        return;
      }
      const name = sampleOutputName(themeName);
      const text = JSON.stringify(
        buildThemeSpecimen(FORMAT, themeName, parsed),
        null,
        2
      );
      lastSampleRef.current = { themeDocName };
      setOutput({ isGenerating: true });
      getDocumentVersionRef.current(name);
      buildDocumentRef.current({ name, text }, undefined, {
        bypassCache: true,
      });
    },
    [documentsStore, setOutput]
  );
  const buildSampleRef = useRef(buildSample);
  useEffect(() => {
    buildSampleRef.current = buildSample;
  });

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ themeDocName?: string }>).detail;
      if (!detail?.themeDocName) return;
      buildSampleRef.current(detail.themeDocName);
    };
    window.addEventListener('preview:buildSpecimen', handler);
    return () => window.removeEventListener('preview:buildSpecimen', handler);
  }, []);

  // A plugin that recompiled may change what the previewed document renders
  // to; like a theme edit, that is the author's cue to Run again.
  useEffect(() => {
    const handler = () => {
      if (!outputStore.getState().isGenerating) {
        setOutput({ isPreviewStale: true });
      }
    };
    window.addEventListener(BROWSER_PLUGINS_CHANGED_EVENT, handler);
    return () =>
      window.removeEventListener(BROWSER_PLUGINS_CHANGED_EVENT, handler);
  }, [outputStore, setOutput]);

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
