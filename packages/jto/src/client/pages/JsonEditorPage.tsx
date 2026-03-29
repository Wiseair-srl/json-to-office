import { useEffect, useState } from 'react';
import { EditorMonacoJsonMemoized } from '../components/json-editor/editor-monaco-json-lazy';
import { DocumentsStoreProvider } from '../store/documents-store-provider';
import { OutputStoreProvider } from '../store/output-store-provider';
import { SettingsStoreProvider } from '../store/settings-store-provider';
import { ThemesStoreProvider } from '../store/themes-store-provider';
import { MonacoPluginProvider } from '../components/MonacoPluginProvider';

export function JsonEditorPage() {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Initialize any necessary data
    setLoading(false);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div>Loading JSON Editor...</div>
      </div>
    );
  }

  return (
    <SettingsStoreProvider>
      <OutputStoreProvider>
        <ThemesStoreProvider>
          <MonacoPluginProvider>
            <DocumentsStoreProvider>
              <section className="flex h-screen w-full flex-col">
                <div className="grow overflow-hidden">
                  <div className="p-4 h-full">
                    <h1 className="text-2xl font-bold mb-4">JSON Editor</h1>
                    <div className="h-full">
                      <EditorMonacoJsonMemoized
                        name="untitled"
                        defaultValue=""
                        saveDocumentDebounceWait={1000}
                      />
                    </div>
                  </div>
                </div>
              </section>
            </DocumentsStoreProvider>
          </MonacoPluginProvider>
        </ThemesStoreProvider>
      </OutputStoreProvider>
    </SettingsStoreProvider>
  );
}
