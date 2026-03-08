/**
 * Clipboard utilities for copying text
 */

/**
 * Copy text to clipboard with fallback for older browsers
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  // Modern browsers - use Clipboard API
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      console.warn(
        'Clipboard API failed, falling back to legacy method:',
        error
      );
    }
  }

  // Fallback for older browsers
  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;

    // Avoid scrolling to bottom
    textArea.style.position = 'fixed';
    textArea.style.top = '0';
    textArea.style.left = '0';
    textArea.style.width = '2em';
    textArea.style.height = '2em';
    textArea.style.padding = '0';
    textArea.style.border = 'none';
    textArea.style.outline = 'none';
    textArea.style.boxShadow = 'none';
    textArea.style.background = 'transparent';

    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);

    return successful;
  } catch (error) {
    console.error('Failed to copy text to clipboard:', error);
    return false;
  }
}

/**
 * Format JSON schema for copying (pretty print with proper indentation)
 */
export function formatSchemaForCopy(schema: any): string {
  try {
    // Ensure we have a valid object
    const schemaObj = typeof schema === 'string' ? JSON.parse(schema) : schema;

    // Pretty print with 2-space indentation
    return JSON.stringify(schemaObj, null, 2);
  } catch (error) {
    console.error('Failed to format schema:', error);
    // Return as-is if formatting fails
    return typeof schema === 'string' ? schema : JSON.stringify(schema);
  }
}

/**
 * Copy formatted JSON schema to clipboard
 */
export async function copySchemaToClipboard(schema: any): Promise<boolean> {
  const formattedSchema = formatSchemaForCopy(schema);
  return copyToClipboard(formattedSchema);
}
