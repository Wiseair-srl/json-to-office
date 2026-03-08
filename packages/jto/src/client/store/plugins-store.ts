import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PluginMetadata } from '../hooks/useDiscovery';

interface PluginsState {
  // Selected plugin names (used for schema generation)
  selectedPlugins: Set<string>;

  // Full plugin metadata for selected plugins
  selectedPluginMetadata: Map<string, PluginMetadata>;

  // Schema application state
  isApplyingPlugins: boolean;
  lastApplyError: string | null;

  // Actions
  selectPlugin: (plugin: PluginMetadata) => void;
  deselectPlugin: (pluginName: string) => void;
  togglePlugin: (plugin: PluginMetadata) => void;
  clearSelections: () => void;
  isPluginSelected: (pluginName: string) => boolean;
  getSelectedPluginsList: () => PluginMetadata[];
  getSelectedPluginNames: () => string[];
  applyPluginsWithValidation: (
    onSuccess?: () => void,
    onError?: (error: string) => void
  ) => Promise<boolean>;
}

export const usePluginsStore = create<PluginsState>()(
  persist(
    (set, get) => ({
      selectedPlugins: new Set<string>(),
      selectedPluginMetadata: new Map<string, PluginMetadata>(),
      isApplyingPlugins: false,
      lastApplyError: null,

      selectPlugin: (plugin: PluginMetadata) => {
        set((state) => {
          const newSelectedPlugins = new Set(state.selectedPlugins);
          const newMetadata = new Map(state.selectedPluginMetadata);

          newSelectedPlugins.add(plugin.name);
          newMetadata.set(plugin.name, plugin);

          return {
            selectedPlugins: newSelectedPlugins,
            selectedPluginMetadata: newMetadata,
          };
        });
      },

      deselectPlugin: (pluginName: string) => {
        set((state) => {
          const newSelectedPlugins = new Set(state.selectedPlugins);
          const newMetadata = new Map(state.selectedPluginMetadata);

          newSelectedPlugins.delete(pluginName);
          newMetadata.delete(pluginName);

          return {
            selectedPlugins: newSelectedPlugins,
            selectedPluginMetadata: newMetadata,
          };
        });
      },

      togglePlugin: (plugin: PluginMetadata) => {
        const isSelected = get().isPluginSelected(plugin.name);
        if (isSelected) {
          get().deselectPlugin(plugin.name);
        } else {
          get().selectPlugin(plugin);
        }
      },

      clearSelections: () => {
        set({
          selectedPlugins: new Set<string>(),
          selectedPluginMetadata: new Map<string, PluginMetadata>(),
        });
      },

      isPluginSelected: (pluginName: string) => {
        return get().selectedPlugins.has(pluginName);
      },

      getSelectedPluginsList: () => {
        return Array.from(get().selectedPluginMetadata.values());
      },

      getSelectedPluginNames: () => {
        return Array.from(get().selectedPlugins);
      },

      applyPluginsWithValidation: async (onSuccess, onError) => {
        set({ isApplyingPlugins: true, lastApplyError: null });

        try {
          // Get the current selected plugins
          const selectedPluginNames = Array.from(get().selectedPlugins);

          // Import Monaco and schema update function dynamically
          const { loader } = await import('@monaco-editor/react');
          const { updateMonacoWithPlugins } = await import(
            '../lib/monaco-config'
          );

          // Get Monaco instance
          const monaco = await loader.init();

          // Apply the plugins and wait for validation
          const success = await updateMonacoWithPlugins(
            monaco,
            selectedPluginNames
          );

          if (!success) {
            throw new Error('Schema validation failed');
          }

          // Success - schema has been applied and validated
          set({ isApplyingPlugins: false, lastApplyError: null });

          if (onSuccess) {
            onSuccess();
          }

          return true;
        } catch (error) {
          const errorMessage =
            error instanceof Error
              ? error.message
              : 'Failed to apply plugin schemas';

          set({
            isApplyingPlugins: false,
            lastApplyError: errorMessage,
          });

          if (onError) {
            onError(errorMessage);
          }

          console.error('Failed to apply plugins with validation:', error);
          return false;
        }
      },
    }),
    {
      name: 'jtp-selected-plugins',
      // Custom storage to handle Set and Map serialization
      storage: {
        getItem: (name) => {
          const str = localStorage.getItem(name);
          if (!str) return null;

          const { state } = JSON.parse(str);
          return {
            state: {
              ...state,
              selectedPlugins: new Set(state.selectedPlugins || []),
              selectedPluginMetadata: new Map(
                state.selectedPluginMetadata || []
              ),
            },
          };
        },
        setItem: (name, value) => {
          const { state } = value as { state: PluginsState };
          const serialized = JSON.stringify({
            state: {
              ...state,
              selectedPlugins: Array.from(state.selectedPlugins),
              selectedPluginMetadata: Array.from(
                state.selectedPluginMetadata.entries()
              ),
            },
          });
          localStorage.setItem(name, serialized);
        },
        removeItem: (name) => localStorage.removeItem(name),
      },
    }
  )
);
