import { useEffect, useRef } from 'react';
import { loader } from '@monaco-editor/react';
import type { Monaco } from '@monaco-editor/react';
import { usePluginsStore } from '../store/plugins-store';
import { updateMonacoWithPlugins } from '../lib/monaco-config';

/**
 * Hook to synchronize selected plugins with Monaco editor schemas
 * This ensures real-time validation includes plugin-specific schemas
 */
export function useMonacoPlugins() {
  const monacoRef = useRef<Monaco | null>(null);
  const selectedPlugins = usePluginsStore((state) => state.selectedPlugins);
  const selectedPluginNames = Array.from(selectedPlugins);
  const previousPluginsRef = useRef<string[]>([]);

  useEffect(() => {
    // Initialize Monaco reference
    loader
      .init()
      .then((monaco) => {
        monacoRef.current = monaco;
        // Initial update with current plugins
        updateMonacoWithPlugins(monaco, selectedPluginNames)
          .then((success) => {
            if (success) {
              console.log(
                '✅ [useMonacoPlugins] Monaco initialized with plugins:',
                selectedPluginNames
              );
            } else {
              console.warn(
                '⚠️ [useMonacoPlugins] Monaco initialization completed with warnings'
              );
            }
          })
          .catch((error) => {
            console.error(
              '❌ [useMonacoPlugins] Failed to update Monaco with plugins:',
              error
            );
          });
        previousPluginsRef.current = [...selectedPluginNames];
      })
      .catch((error) => {
        console.error('Failed to initialize Monaco:', error);
      });
  }, []); // Keep empty dependency to run only once

  useEffect(() => {
    // Check if plugins have actually changed
    const pluginsChanged =
      selectedPluginNames.length !== previousPluginsRef.current.length ||
      selectedPluginNames.some(
        (name, index) => name !== previousPluginsRef.current[index]
      );

    if (!pluginsChanged) {
      return;
    }

    // Update Monaco schemas when plugins change
    if (monacoRef.current) {
      console.log(
        '🔄 [useMonacoPlugins] Updating Monaco schemas for plugins:',
        selectedPluginNames
      );
      updateMonacoWithPlugins(monacoRef.current, selectedPluginNames).catch(
        (error) => {
          console.error(
            '⚠️ [useMonacoPlugins] Failed to update Monaco schemas:',
            error
          );
        }
      );
      previousPluginsRef.current = [...selectedPluginNames];
    } else {
      console.log(
        '⚠️ [useMonacoPlugins] Monaco not yet initialized, skipping update'
      );
    }
  }, [selectedPluginNames]);

  return {
    monaco: monacoRef.current,
    selectedPlugins: selectedPluginNames,
  };
}
