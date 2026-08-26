/**
 * Monaco Editor Selection Utilities
 * Provides functionality to extract selected text and JSON paths from Monaco editor instances
 */

import type { editor as MonacoEditorType } from 'monaco-editor';
import type { Monaco } from '@monaco-editor/react';

export interface SelectionContext {
  selectedText: string;
  jsonPath?: string;
  propertyKey?: string;
  fullDocument?: any;
  isValidJson: boolean;
  startLine: number;
  endLine: number;
}

/**
 * Get the current selection context from a Monaco editor instance
 */
export function getSelectionContext(
  editor: MonacoEditorType.IStandaloneCodeEditor,
  monaco: Monaco
): SelectionContext | null {
  if (!editor || !monaco) {
    return null;
  }

  const model = editor.getModel();
  if (!model) {
    return null;
  }

  const selection = editor.getSelection();
  if (!selection) {
    return null;
  }

  // Get selected text
  const selectedText = model.getValueInRange(selection);

  // If no text is selected, get the word at cursor position
  const finalText = selectedText || getWordAtCursor(editor, monaco);

  if (!finalText) {
    return null;
  }

  // Get the full document text
  const fullDocumentText = model.getValue();
  let fullDocument: any = null;
  let isValidJson = false;

  try {
    fullDocument = JSON.parse(fullDocumentText);
    isValidJson = true;
  } catch {
    // Document is not valid JSON
  }

  // Try to determine the JSON path
  const jsonPath = isValidJson
    ? getJsonPathAtPosition(
        fullDocumentText,
        selection.startLineNumber,
        selection.startColumn
      )
    : undefined;

  // Extract property key if we're selecting a property value
  const propertyKey = extractPropertyKey(
    fullDocumentText,
    selection.startLineNumber,
    selection.startColumn
  );

  return {
    selectedText: finalText,
    jsonPath,
    propertyKey,
    fullDocument,
    isValidJson,
    startLine: selection.startLineNumber,
    endLine: selection.endLineNumber,
  };
}

/**
 * Get the word at the current cursor position
 */
function getWordAtCursor(
  editor: MonacoEditorType.IStandaloneCodeEditor,
  _monaco: Monaco
): string {
  const model = editor.getModel();
  const position = editor.getPosition();

  if (!model || !position) {
    return '';
  }

  const word = model.getWordAtPosition(position);
  if (word) {
    return model.getValueInRange({
      startLineNumber: position.lineNumber,
      startColumn: word.startColumn,
      endLineNumber: position.lineNumber,
      endColumn: word.endColumn,
    });
  }

  return '';
}

/**
 * Determine the JSON path at a specific position in the document
 */
function getJsonPathAtPosition(
  documentText: string,
  lineNumber: number,
  column: number
): string | undefined {
  try {
    // Split document into lines
    const lines = documentText.split('\n');

    // Build a path by analyzing the nesting level
    const path: string[] = [];
    let depth = 0;
    let inArray = false;
    let arrayIndex = 0;

    for (let i = 0; i < Math.min(lineNumber, lines.length); i++) {
      const line = lines[i];

      // Count braces and brackets to track nesting
      for (let j = 0; j < line.length; j++) {
        const char = line[j];

        if (i === lineNumber - 1 && j >= column) {
          // We've reached the target position
          break;
        }

        if (char === '{') {
          depth++;
        } else if (char === '}') {
          depth--;
          if (path.length > depth) {
            path.pop();
          }
        } else if (char === '[') {
          inArray = true;
          arrayIndex = 0;
        } else if (char === ']') {
          inArray = false;
          if (path[path.length - 1]?.match(/\[\d+\]$/)) {
            path.pop();
          }
        } else if (char === ',' && inArray) {
          arrayIndex++;
        }
      }

      // Try to extract property names from the line
      const propertyMatch = line.match(/^\s*"([^"]+)"\s*:/);
      if (propertyMatch) {
        // Adjust path length to current depth
        while (path.length >= depth) {
          path.pop();
        }

        if (inArray) {
          path.push(`${propertyMatch[1]}[${arrayIndex}]`);
        } else {
          path.push(propertyMatch[1]);
        }
      }
    }

    return path.length > 0 ? path.join('.') : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Extract the property key at a specific position
 */
function extractPropertyKey(
  documentText: string,
  lineNumber: number,
  _column: number
): string | undefined {
  try {
    const lines = documentText.split('\n');
    if (lineNumber > lines.length) {
      return undefined;
    }

    const line = lines[lineNumber - 1];

    // Look for a property key on the same line
    const propertyMatch = line.match(/^\s*"([^"]+)"\s*:/);
    if (propertyMatch) {
      return propertyMatch[1];
    }

    // Look backwards for the nearest property key
    for (let i = lineNumber - 2; i >= 0; i--) {
      const prevLine = lines[i];
      const prevMatch = prevLine.match(/^\s*"([^"]+)"\s*:/);
      if (prevMatch) {
        // Check if this property's value extends to our line
        // This is a simplified check - more complex logic might be needed
        return prevMatch[1];
      }

      // Stop if we hit a closing brace (end of object)
      if (prevLine.includes('}')) {
        break;
      }
    }

    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Format a selection context for display
 */
export function formatSelectionContext(context: SelectionContext): string {
  const parts: string[] = [];

  if (context.jsonPath) {
    parts.push(`Path: ${context.jsonPath}`);
  }

  if (context.propertyKey) {
    parts.push(`Property: ${context.propertyKey}`);
  }

  parts.push(`Lines: ${context.startLine}-${context.endLine}`);

  return parts.join(' | ');
}

/**
 * Extract a JSON subtree from a path
 */
export function extractJsonSubtree(obj: any, path: string): any {
  if (!obj || !path) {
    return undefined;
  }

  const parts = path.split('.');
  let current = obj;

  for (const part of parts) {
    if (!current) {
      return undefined;
    }

    // Handle array notation like "items[0]"
    const arrayMatch = part.match(/^([^[]+)\[(\d+)\]$/);
    if (arrayMatch) {
      const [, key, index] = arrayMatch;
      current = current[key];
      if (Array.isArray(current)) {
        current = current[parseInt(index, 10)];
      } else {
        return undefined;
      }
    } else {
      current = current[part];
    }
  }

  return current;
}

/**
 * Create a context snippet for AI
 */
export function createContextSnippet(context: SelectionContext): string {
  const lines: string[] = [];

  if (context.jsonPath) {
    lines.push(`JSON Path: ${context.jsonPath}`);
  }

  if (context.selectedText.length > 500) {
    lines.push(
      `Selected Text (truncated): ${context.selectedText.substring(0, 500)}...`
    );
  } else {
    lines.push(`Selected Text: ${context.selectedText}`);
  }

  if (context.isValidJson && context.fullDocument && context.jsonPath) {
    const subtree = extractJsonSubtree(context.fullDocument, context.jsonPath);
    if (subtree !== undefined) {
      const subtreeStr = JSON.stringify(subtree, null, 2);
      if (subtreeStr.length > 500) {
        lines.push(
          `Context Value (truncated): ${subtreeStr.substring(0, 500)}...`
        );
      } else {
        lines.push(`Context Value: ${subtreeStr}`);
      }
    }
  }

  return lines.join('\n');
}
