import { useEffect, useRef, useContext, useSyncExternalStore } from 'react';
import { loader } from '@monaco-editor/react';
import type { Monaco } from '@monaco-editor/react';
import { usePluginsStore } from '../store/plugins-store';
import {
  activePluginsSignature,
  browserComponentsForSchema,
  useBrowserPluginsStore,
} from '../store/browser-plugins-store';
import { ThemesStoreContext } from '../store/themes-store-provider';
import { updateMonacoWithPlugins } from '../lib/monaco-config';

const emptyNames: string[] = [];
const subscribe = () => () => {};

/**
 * Read custom theme names from the ThemesStore if available,
 * returning [] when outside a ThemesStoreProvider.
 *
 * getSnapshot must return a referentially stable value to avoid
 * infinite re-renders with useSyncExternalStore.
 */
function useCustomThemeNames(): string[] {
  const store = useContext(ThemesStoreContext);
  const cachedRef = useRef<string[]>(emptyNames);

  const getSnapshot = store
    ? () => {
        const next = store.getState().getAllThemeNames();
        // Only update the cached reference when the list actually changes
        if (
          next.length !== cachedRef.current.length ||
          next.some((n, i) => n !== cachedRef.current[i])
        ) {
          cachedRef.current = next;
        }
        return cachedRef.current;
      }
    : () => emptyNames;

  return useSyncExternalStore(store ? store.subscribe : subscribe, getSnapshot);
}

/**
 * Hook to synchronize selected plugins and custom themes with Monaco editor schemas.
 * Ensures real-time validation and autocomplete include plugin-specific schemas
 * and custom theme names.
 */
export function useMonacoPlugins() {
  const monacoRef = useRef<Monaco | null>(null);
  const selectedPlugins = usePluginsStore((state) => state.selectedPlugins);
  const selectedPluginNames = Array.from(selectedPlugins);
  const customThemeNames = useCustomThemeNames();
  // A string that changes exactly when the active browser plugins or their
  // schemas change — cheaper to compare than the records themselves.
  const browserSignature = useBrowserPluginsStore(activePluginsSignature);
  const themesStore = useContext(ThemesStoreContext);
  const themesStoreRef = useRef(themesStore);
  themesStoreRef.current = themesStore;
  const previousPluginsRef = useRef<string[]>([]);
  const previousThemesRef = useRef<string[]>([]);
  const previousBrowserRef = useRef<string>('');

  useEffect(() => {
    loader
      .init()
      .then((monaco) => {
        monacoRef.current = monaco;
        // Read current state from stores (not stale closure) since
        // zustand persist may have hydrated while loader.init() was pending
        const currentPlugins = Array.from(
          usePluginsStore.getState().selectedPlugins
        );
        const currentThemes =
          themesStoreRef.current?.getState().getAllThemeNames() ?? [];
        const browserState = useBrowserPluginsStore.getState();
        updateMonacoWithPlugins(
          monaco,
          currentPlugins,
          currentThemes,
          browserComponentsForSchema(browserState)
        )
          .then((success) => {
            if (success) {
              console.log(
                '[useMonacoPlugins] Monaco initialized with plugins:',
                currentPlugins
              );
            } else {
              console.warn(
                '[useMonacoPlugins] Monaco initialization completed with warnings'
              );
            }
          })
          .catch((error) => {
            console.error(
              '[useMonacoPlugins] Failed to update Monaco with plugins:',
              error
            );
          });
        previousPluginsRef.current = [...currentPlugins];
        previousThemesRef.current = [...currentThemes];
        previousBrowserRef.current = activePluginsSignature(browserState);
      })
      .catch((error) => {
        console.error('Failed to initialize Monaco:', error);
      });
  }, []); // Keep empty dependency to run only once

  useEffect(() => {
    const pluginsChanged =
      selectedPluginNames.length !== previousPluginsRef.current.length ||
      selectedPluginNames.some(
        (name, index) => name !== previousPluginsRef.current[index]
      );

    const themesChanged =
      customThemeNames.length !== previousThemesRef.current.length ||
      customThemeNames.some(
        (name, index) => name !== previousThemesRef.current[index]
      );

    const browserChanged = browserSignature !== previousBrowserRef.current;

    if (!pluginsChanged && !themesChanged && !browserChanged) {
      return;
    }

    if (monacoRef.current) {
      updateMonacoWithPlugins(
        monacoRef.current,
        selectedPluginNames,
        customThemeNames,
        browserComponentsForSchema(useBrowserPluginsStore.getState())
      ).catch((error) => {
        console.error(
          '[useMonacoPlugins] Failed to update Monaco schemas:',
          error
        );
      });
      previousPluginsRef.current = [...selectedPluginNames];
      previousThemesRef.current = [...customThemeNames];
      previousBrowserRef.current = browserSignature;
    }
  }, [selectedPluginNames, customThemeNames, browserSignature]);

  return {
    monaco: monacoRef.current,
    selectedPlugins: selectedPluginNames,
  };
}
