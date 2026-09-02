import { useBrowserPluginsSync } from '../hooks/useBrowserPluginsSync';

/**
 * Mounts the browser-plugin sync once, under the documents store it watches.
 */
export function BrowserPluginsProvider({
  diskPluginNames,
  children,
}: {
  diskPluginNames: readonly string[];
  children: React.ReactNode;
}) {
  useBrowserPluginsSync(diskPluginNames);
  return <>{children}</>;
}
