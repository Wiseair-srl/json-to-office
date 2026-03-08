import { useShallow } from 'zustand/react/shallow';
import { useDocumentsStore } from '../store/documents-store-provider';
import { useOutputStore } from '../store/output-store-provider';
import { useSettingsStore } from '../store/settings-store-provider';
import { useThemesStore } from '../store/themes-store-provider';

// Documents Store Selectors
export const useDocuments = () =>
  useDocumentsStore(useShallow((state) => state.documents));

export const useActiveDocument = () => {
  const activeTabName = useDocumentsStore((state) => state.activeTab);
  const documents = useDocumentsStore((state) => state.documents);
  return documents.find((doc) => doc.name === activeTabName);
};

export const useDocumentActions = () =>
  useDocumentsStore(
    useShallow((state) => ({
      createDocument: state.createDocument,
      saveDocument: state.saveDocument,
      deleteDocument: state.deleteDocument,
      closeDocument: state.closeDocument,
      setActiveTab: state.setActiveTab,
    }))
  );

export const useOpenTabs = () =>
  useDocumentsStore(useShallow((state) => state.openTabs));

// Output Store Selectors
export const useOutput = () =>
  useOutputStore(
    useShallow((state) => ({
      name: state.name,
      text: state.text,
      blob: state.blob,
      globalError: state.globalError,
      isGenerating: state.isGenerating,
      generationProgress: state.generationProgress,
    }))
  );

export const useOutputActions = () =>
  useOutputStore(
    useShallow((state) => ({
      setOutput: state.setOutput,
      // clearOutput was removed, only setOutput is available
    }))
  );

// Settings Store Selectors
export const useSettings = () =>
  useSettingsStore(
    useShallow((state) => ({
      saveDocumentDebounceWait: state.saveDocumentDebounceWait,
      autoReload: state.autoReload,
    }))
  );

export const useSaveDebounceWait = () =>
  useSettingsStore((state) => state.saveDocumentDebounceWait);

// Themes Store Selectors
export const useCustomThemes = () =>
  useThemesStore(useShallow((state) => state.customThemes));

export const useThemeActions = () =>
  useThemesStore(
    useShallow((state) => ({
      updateTheme: state.updateTheme,
      removeTheme: state.removeTheme,
      getTheme: state.getTheme,
      getAllThemeNames: state.getAllThemeNames,
      isThemeValid: state.isThemeValid,
    }))
  );

// Combined selectors for common patterns
export const useDocumentWithType = (documentName: string) => {
  const document = useDocumentsStore((state) =>
    state.documents.find((doc) => doc.name === documentName)
  );
  const documentType = useDocumentsStore(
    (state) => state.documentTypes[documentName]
  );
  return { document, documentType };
};
