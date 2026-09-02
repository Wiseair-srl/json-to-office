import { useEffect, useMemo } from 'react';
import { DevEnv } from '../components/playground/dev-env';
import { BrowserPluginsProvider } from '../components/BrowserPluginsProvider';
import { SidebarProvider } from '../components/ui/sidebar';
import { DocumentsStoreProvider } from '../store/documents-store-provider';
import { OutputStoreProvider } from '../store/output-store-provider';
import { SettingsStoreProvider } from '../store/settings-store-provider';
import { ThemesStoreProvider } from '../store/themes-store-provider';
import { ChatStoreProvider } from '../store/chat-store-provider';
import { MonacoPluginProvider } from '../components/MonacoPluginProvider';
import { useDiscovery, useLoadPlugins } from '../hooks/useDiscovery';
import { usePluginsStore } from '../store/plugins-store';

export function HomePage() {
  const { data: discoveryData, loading, error } = useDiscovery();
  const { loadPlugins } = useLoadPlugins();
  const applyPluginsWithValidation = usePluginsStore(
    (state) => state.applyPluginsWithValidation
  );
  // Names a browser plugin may not take: the sync checks new compiles against
  // what discovery found on disk.
  const diskPluginNames = useMemo(
    () => discoveryData?.plugins.map((plugin) => plugin.name) ?? [],
    [discoveryData]
  );

  /**
   * Ask the server to register its disk plugins once discovery has named
   * them, then hand Monaco the persisted selection.
   *
   * Skipped where the server will not load them (`pluginAutoload` off): the
   * bootstrap POST answers 401 there, and asking for a refusal on every load
   * only fills the console. The apply below runs either way — it carries the
   * browser plugins too, and those are unaffected by any of this.
   */
  useEffect(() => {
    if (!discoveryData) return;
    const bootstrap =
      discoveryData.pluginAutoload && discoveryData.plugins.length > 0
        ? loadPlugins()
        : Promise.resolve(false);

    bootstrap.finally(() => {
      const selected = usePluginsStore.getState().selectedPlugins;
      if (selected.size > 0) applyPluginsWithValidation();
    });
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
          <MonacoPluginProvider>
            <DocumentsStoreProvider>
              <BrowserPluginsProvider diskPluginNames={diskPluginNames}>
                <ChatStoreProvider>
                  <SidebarProvider>
                    <section className="flex h-screen w-full flex-col">
                      <div className="grow overflow-hidden">
                        <DevEnv discoveryData={discoveryData} />
                      </div>
                    </section>
                  </SidebarProvider>
                </ChatStoreProvider>
              </BrowserPluginsProvider>
            </DocumentsStoreProvider>
          </MonacoPluginProvider>
        </ThemesStoreProvider>
      </OutputStoreProvider>
    </SettingsStoreProvider>
  );
}
