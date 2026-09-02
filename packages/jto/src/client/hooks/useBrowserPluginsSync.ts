import { useContext, useEffect, useRef } from 'react';
import { DocumentsStoreContext } from '../store/documents-store-provider';
import {
  componentNameOwner,
  useBrowserPluginsStore,
  whenBrowserPluginsHydrated,
} from '../store/browser-plugins-store';
import { compilePlugin, disposePluginModel } from '../lib/plugins/compiler';
import { compileQueue } from '../lib/plugins/compile-queue';
import { extractPluginExamples } from '../lib/plugins/examples';
import { hashSource } from '../lib/plugins/hash';
import { pluginHost, PluginTimeoutError } from '../lib/plugins/host';
import {
  PLUGIN_NAME_PATTERN,
  standardComponentNames,
} from '../lib/plugins/names';
import {
  NETWORK_OFF_MARKER,
  type BrowserPluginRecord,
  type PluginDiagnostic,
} from '../lib/plugins/types';
import { FORMAT } from '../lib/env';

/**
 * Keep every `*.component.ts` file compiled.
 *
 * Watches the documents store: a plugin file whose text no longer matches
 * the hash its record was built from is recompiled after a short debounce,
 * loaded into its sandbox to be described, and checked for a name the format
 * already uses. A file that disappears takes its record, its sandbox and its
 * Monaco model with it. Compilation reads the live editor model when the
 * file is open, so what runs is what is on screen, not the last save.
 *
 * Name conflicts are re-judged without recompiling whenever the set of
 * records changes: the metadata is kept on a conflicting record, so the
 * newcomer becomes ready the moment the owner is renamed or deleted.
 */

const COMPILE_DEBOUNCE_MS = 400;

const PLUGIN_TYPE = 'application/typescript+plugin';

/** Fired on `window` after a plugin finished compiling, ready or not. */
export const BROWSER_PLUGINS_CHANGED_EVENT = 'browser-plugins:changed';

function announceChange(docName: string): void {
  window.dispatchEvent(
    new CustomEvent(BROWSER_PLUGINS_CHANGED_EVENT, { detail: { docName } })
  );
}

function conflictDiagnostic(message: string): PluginDiagnostic {
  return {
    severity: 'error',
    source: 'playground',
    code: 'name-conflict',
    message,
  };
}

/** A sandbox failure, worded for the author. */
function sandboxDiagnostic(error: unknown): PluginDiagnostic {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes(NETWORK_OFF_MARKER)) {
    return {
      severity: 'error',
      source: 'playground',
      code: 'network-off',
      message: message.replace(NETWORK_OFF_MARKER, '').trim(),
    };
  }
  if (error instanceof PluginTimeoutError) {
    return {
      severity: 'error',
      source: 'sandbox',
      code: 'timeout',
      message: `${message} Edit the file to compile it again.`,
    };
  }
  return { severity: 'error', source: 'sandbox', message };
}

export function useBrowserPluginsSync(
  diskPluginNames: readonly string[]
): void {
  const documentsStore = useContext(DocumentsStoreContext);
  if (!documentsStore) {
    throw new Error(
      'useBrowserPluginsSync must be used within DocumentsStoreProvider'
    );
  }
  // Read at compile time rather than captured: discovery finishes after the
  // first compile more often than not.
  const diskNamesRef = useRef<readonly string[]>(diskPluginNames);
  diskNamesRef.current = diskPluginNames;

  useEffect(() => {
    let disposed = false;

    /** Why `componentName` cannot be `docName`'s, or null when it can. */
    const nameConflict = (
      docName: string,
      componentName: string
    ): string | null => {
      if (!PLUGIN_NAME_PATTERN.test(componentName)) {
        return `Component name "${componentName}" must start with a letter and contain only letters, digits, "-" and "_".`;
      }
      if (standardComponentNames(FORMAT).has(componentName)) {
        return `"${componentName}" is a built-in ${FORMAT} component; choose another name.`;
      }
      if (diskNamesRef.current.includes(componentName)) {
        return `"${componentName}" is already provided by a plugin on disk; choose another name or disable that plugin.`;
      }
      const owner = componentNameOwner(
        useBrowserPluginsStore.getState().records,
        componentName
      );
      if (owner && owner !== docName) {
        return `"${componentName}" is already defined by ${owner}; rename one of them.`;
      }
      return null;
    };

    /**
     * Re-judge every settled record's name without compiling. Only the
     * conflict diagnostic moves; TypeScript and sandbox diagnostics stay.
     */
    const reconcileConflicts = (): void => {
      const store = useBrowserPluginsStore.getState();
      for (const record of Object.values(store.records)) {
        if (
          !record.metadata ||
          record.status === 'compiling' ||
          record.status === 'idle'
        ) {
          continue;
        }
        const others = record.diagnostics.filter(
          (d) => d.code !== 'name-conflict'
        );
        const hadConflict = others.length !== record.diagnostics.length;
        const conflict = nameConflict(record.docName, record.metadata.name);
        const otherErrors = others.some((d) => d.severity === 'error');
        if (conflict && !hadConflict) {
          store.upsert(record.docName, {
            status: 'error',
            diagnostics: [...others, conflictDiagnostic(conflict)],
          });
        } else if (!conflict && hadConflict) {
          store.upsert(record.docName, {
            status: otherErrors || !record.js ? 'error' : 'ready',
            diagnostics: others,
          });
          announceChange(record.docName);
        }
      }
    };

    const compileNow = async (docName: string): Promise<void> => {
      const doc = documentsStore
        .getState()
        .documents.find((d) => d.name === docName);
      if (!doc || disposed) return;
      const store = useBrowserPluginsStore.getState();
      const record = store.records[docName];
      const hash = hashSource(doc.text);
      const current =
        record &&
        record.sourceHash === hash &&
        (record.status === 'ready' || record.status === 'error');
      if (current) return;

      // A settled record may already describe the live editor text, which the
      // store has not caught up with yet; the compiler checks before working.
      const settled: BrowserPluginRecord | undefined =
        record && (record.status === 'ready' || record.status === 'error')
          ? record
          : undefined;
      store.upsert(docName, {
        status: 'compiling',
        sourceHash: hash,
        diagnostics: [],
      });
      try {
        const compiled = await compilePlugin(
          docName,
          doc.text,
          settled?.sourceHash
        );
        if (disposed) return;
        if (compiled.skipped && settled) {
          useBrowserPluginsStore.getState().upsert(docName, {
            status: settled.status,
            sourceHash: settled.sourceHash,
            diagnostics: settled.diagnostics,
          });
          return;
        }
        const finalHash = hashSource(compiled.source);
        if (!compiled.js) {
          pluginHost.dispose(docName);
          useBrowserPluginsStore.getState().upsert(docName, {
            status: 'error',
            sourceHash: finalHash,
            js: undefined,
            metadata: undefined,
            diagnostics: compiled.diagnostics,
          });
          announceChange(docName);
          return;
        }
        const allowNetwork =
          useBrowserPluginsStore.getState().records[docName]?.allowNetwork ??
          false;
        const metadata = await pluginHost.load(docName, {
          js: compiled.js,
          format: FORMAT,
          allowNetwork,
          examples: extractPluginExamples(compiled.source),
        });
        if (disposed) return;
        // The record must carry its metadata before the ownership check, or
        // it cannot own its own name.
        useBrowserPluginsStore.getState().upsert(docName, {
          status: 'ready',
          sourceHash: finalHash,
          js: compiled.js,
          metadata,
          diagnostics: compiled.diagnostics,
        });
        const conflict = nameConflict(docName, metadata.name);
        if (conflict) {
          useBrowserPluginsStore.getState().upsert(docName, {
            status: 'error',
            diagnostics: [
              ...compiled.diagnostics,
              conflictDiagnostic(conflict),
            ],
          });
        }
        reconcileConflicts();
        announceChange(docName);
      } catch (error) {
        if (disposed) return;
        pluginHost.dispose(docName);
        useBrowserPluginsStore.getState().upsert(docName, {
          status: 'error',
          sourceHash: hash,
          js: undefined,
          metadata: undefined,
          diagnostics: [sandboxDiagnostic(error)],
        });
        reconcileConflicts();
        announceChange(docName);
      }
    };

    const reconcile = (): void => {
      const { documents, documentTypes } = documentsStore.getState();
      const pluginDocs = documents.filter(
        (d) => documentTypes[d.name] === PLUGIN_TYPE
      );
      const present = new Set(pluginDocs.map((d) => d.name));
      const pluginsStore = useBrowserPluginsStore.getState();
      let removed = false;
      for (const name of Object.keys(pluginsStore.records)) {
        if (!present.has(name)) {
          pluginsStore.remove(name);
          pluginHost.dispose(name);
          disposePluginModel(name);
          compileQueue.cancel(name);
          removed = true;
        }
      }
      if (removed) reconcileConflicts();
      for (const doc of pluginDocs) {
        const record = pluginsStore.records[doc.name];
        const stale =
          !record ||
          record.sourceHash !== hashSource(doc.text) ||
          record.status === 'idle' ||
          record.status === 'compiling';
        if (stale) compileQueue.schedule(doc.name, COMPILE_DEBOUNCE_MS);
      }
    };

    compileQueue.setRunner(compileNow);
    let unsubscribe: (() => void) | undefined;
    // The persisted records arrive from IndexedDB; a reconcile before that
    // would compile everything and then be overwritten by the read.
    whenBrowserPluginsHydrated().then(() => {
      if (disposed) return;
      reconcile();
      unsubscribe = documentsStore.subscribe((state, previous) => {
        if (
          state.documents !== previous.documents ||
          state.documentTypes !== previous.documentTypes
        ) {
          reconcile();
        }
      });
    });

    return () => {
      disposed = true;
      unsubscribe?.();
      compileQueue.reset();
    };
  }, [documentsStore]);
}
