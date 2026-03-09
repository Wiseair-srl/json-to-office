import { useEffect } from 'react';
import { DevEnv } from '../components/playground/dev-env';
import { SidebarProvider } from '../components/ui/sidebar';
import { DocumentsStoreProvider } from '../store/documents-store-provider';
import { OutputStoreProvider } from '../store/output-store-provider';
import { SettingsStoreProvider } from '../store/settings-store-provider';
import { ThemesStoreProvider } from '../store/themes-store-provider';
import { ChatStoreProvider } from '../store/chat-store-provider';
import { useDiscovery, useLoadPlugins } from '../hooks/useDiscovery';
import { usePluginsStore } from '../store/plugins-store';

export function HomePage() {
  const { data: discoveryData, loading, error } = useDiscovery();
  const { loadPlugins } = useLoadPlugins();
  const applyPluginsWithValidation = usePluginsStore(
    (state) => state.applyPluginsWithValidation
  );

  // Load plugins into the registry when discovery completes,
  // then auto-apply persisted plugin selections to Monaco
  useEffect(() => {
    if (discoveryData && discoveryData.plugins.length > 0) {
      loadPlugins().then((success) => {
        if (success) {
          console.log('Plugins loaded successfully');
          // Auto-apply persisted plugin selections so Monaco schema is up-to-date
          const selected = usePluginsStore.getState().selectedPlugins;
          if (selected.size > 0) {
            console.log(
              'Auto-applying persisted plugin selections:',
              Array.from(selected)
            );
            applyPluginsWithValidation();
          }
        }
      });
    }
  }, [discoveryData, loadPlugins, applyPluginsWithValidation]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="text-lg font-medium">
            Discovering project resources...
          </div>
          <div className="text-sm text-muted-foreground mt-2">
            Searching for documents, themes, and plugins
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="text-lg font-medium text-destructive">
            Discovery failed
          </div>
          <div className="text-sm text-muted-foreground mt-2">{error}</div>
          <div className="text-xs text-muted-foreground mt-4">
            The playground will work with limited functionality.
          </div>
        </div>
      </div>
    );
  }

  return (
    <SettingsStoreProvider>
      <OutputStoreProvider>
        <ThemesStoreProvider>
          <DocumentsStoreProvider>
            <ChatStoreProvider>
              <SidebarProvider>
                <section className="flex h-screen w-full flex-col">
                  <div className="grow overflow-hidden">
                    <DevEnv discoveryData={discoveryData} />
                  </div>
                </section>
              </SidebarProvider>
            </ChatStoreProvider>
          </DocumentsStoreProvider>
        </ThemesStoreProvider>
      </OutputStoreProvider>
    </SettingsStoreProvider>
  );
}
