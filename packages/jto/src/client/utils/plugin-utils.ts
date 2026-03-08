/**
 * Utility functions for plugin-related operations
 */

/**
 * Copy plugin example configuration to clipboard
 * @param pluginName - The name of the plugin
 * @param exampleConfig - The example configuration object
 * @returns Promise that resolves when the text is copied
 */
export async function copyPluginExample(
  pluginName: string,
  exampleConfig: any
): Promise<void> {
  const usage = JSON.stringify(
    {
      name: pluginName,
      props: exampleConfig,
      children: [],
    },
    null,
    2
  );

  await navigator.clipboard.writeText(usage);
}
