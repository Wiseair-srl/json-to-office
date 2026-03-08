import { persist, devtools } from 'zustand/middleware';
import { createStore } from 'zustand/vanilla';
import type { ThemeConfigJson } from '@json-to-office/shared-pptx';
import { validateThemeJson, getThemeName } from '../lib/theme-validation';
import { themeChangeEmitter } from '../utils/theme-change-emitter';

export type CustomTheme = {
  name: string;
  content: string;
  parsed?: ThemeConfigJson;
  valid: boolean;
  lastModified: Date;
};

export type ThemesState = {
  customThemes: { [name: string]: CustomTheme };
};

export type ThemesActions = {
  updateTheme: (documentName: string, content: string) => void;
  removeTheme: (documentName: string) => void;
  getTheme: (themeName: string) => ThemeConfigJson | null;
  getAllThemeNames: () => string[];
  isThemeValid: (themeName: string) => boolean;
};

export type ThemesStore = ThemesState & ThemesActions;

export const initThemesStore = (): ThemesState => {
  return {
    customThemes: {},
  };
};

export const defaultInitThemesState: ThemesState = {
  ...initThemesStore(),
};

export const createThemesStore = (
  initState: ThemesState = defaultInitThemesState
) => {
  return createStore<ThemesStore>()(
    devtools(
      persist(
        (set, get) => ({
          ...initState,

          updateTheme: (documentName, content) =>
            set((state) => {
              const validation = validateThemeJson(content);

              let parsed: ThemeConfigJson | undefined;
              let themeName = documentName;

              if (validation.valid) {
                try {
                  const parsedContent = JSON.parse(content);
                  parsed = parsedContent;
                  const extractedName = getThemeName(parsedContent);
                  if (extractedName) {
                    themeName = extractedName;
                  }
                } catch {
                  // Keep the document name if parsing fails
                }
              }

              const existingTheme = state.customThemes[documentName];
              const isUpdate = !!existingTheme;
              const hasContentChanged = existingTheme?.content !== content;

              const customTheme: CustomTheme = {
                name: themeName,
                content,
                parsed,
                valid: validation.valid,
                lastModified: new Date(),
              };

              // Emit theme change if content changed OR if this is a newly valid theme
              const shouldEmitEvent =
                (hasContentChanged ||
                  (!existingTheme?.valid && validation.valid)) &&
                validation.valid;

              console.log('ThemeStore: Update theme analysis', {
                documentName,
                themeName,
                hasContentChanged,
                existingValid: existingTheme?.valid,
                newValid: validation.valid,
                shouldEmitEvent,
                isUpdate,
                parsedTheme: parsed,
              });

              if (shouldEmitEvent) {
                // Use setTimeout to ensure state is updated before event is processed
                setTimeout(() => {
                  console.log('ThemeStore: Emitting theme change event', {
                    themeName,
                    changeType: isUpdate ? 'update' : 'create',
                  });
                  themeChangeEmitter.emitThemeChange({
                    themeName,
                    timestamp: Date.now(),
                    changeType: isUpdate ? 'update' : 'create',
                  });
                }, 0);
              }

              return {
                customThemes: {
                  ...state.customThemes,
                  [documentName]: customTheme,
                },
              };
            }),

          removeTheme: (documentName) =>
            set((state) => {
              const removedTheme = state.customThemes[documentName];
              const newCustomThemes = { ...state.customThemes };
              delete newCustomThemes[documentName];

              // Emit theme deletion event
              if (removedTheme) {
                setTimeout(() => {
                  themeChangeEmitter.emitThemeChange({
                    themeName: removedTheme.name,
                    timestamp: Date.now(),
                    changeType: 'delete',
                  });
                }, 0);
              }

              return {
                customThemes: newCustomThemes,
              };
            }),

          getTheme: (themeName) => {
            const state = get();

            // First check custom themes by theme name
            for (const customTheme of Object.values(state.customThemes)) {
              if (
                customTheme.valid &&
                customTheme.name === themeName &&
                customTheme.parsed
              ) {
                return customTheme.parsed;
              }
            }

            // Theme not found in custom themes
            return null;
          },

          getAllThemeNames: () => {
            const state = get();
            const names: string[] = [];

            // Add custom theme names
            for (const customTheme of Object.values(state.customThemes)) {
              if (customTheme.valid && customTheme.name) {
                names.push(customTheme.name);
              }
            }

            return names;
          },

          isThemeValid: (themeName) => {
            const state = get();

            // Check custom themes
            for (const customTheme of Object.values(state.customThemes)) {
              if (customTheme.name === themeName) {
                return customTheme.valid;
              }
            }

            return false;
          },
        }),
        {
          name: 'themes-storage',
          version: 3, // Increment to clear old DOCX-style theme data
          // Only persist the themes data, not the functions
          partialize: (state) => ({ customThemes: state.customThemes }),
          // Handle date deserialization when loading from storage
          onRehydrateStorage: () => (state) => {
            if (state && state.customThemes) {
              // Convert lastModified strings back to Date objects
              Object.keys(state.customThemes).forEach((key) => {
                const theme = state.customThemes[key];
                if (
                  theme.lastModified &&
                  typeof theme.lastModified === 'string'
                ) {
                  theme.lastModified = new Date(theme.lastModified);
                }
              });
            }
          },
        }
      )
    )
  );
};
