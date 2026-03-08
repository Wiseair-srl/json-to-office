import { useMonacoPlugins } from '../hooks/useMonacoPlugins';

/**
 * Provider component that manages Monaco plugin synchronization
 * This must be rendered within the app after stores are initialized
 */
export function MonacoPluginProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // Initialize Monaco plugin synchronization
  useMonacoPlugins();

  return <>{children}</>;
}
