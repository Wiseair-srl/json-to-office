/**
 * Warnings Document Generator
 * Utility to generate a document from generation warnings
 */

import type { GenerationWarning } from '@json-to-office/shared-docx';
import type { ComponentDefinition, ReportComponentDefinition } from '../types';

/**
 * Generate a report document from warnings
 * Returns null if there are no warnings
 */
export function generateWarningsDocument(
  warnings: GenerationWarning[] | null
): ReportComponentDefinition | null {
  if (!warnings || warnings.length === 0) {
    return null;
  }

  const children: ComponentDefinition[] = [
    {
      name: 'heading',
      props: {
        level: 1,
        text: 'Document Generation Warnings',
      },
    },
    {
      name: 'paragraph',
      props: {
        text: `${warnings.length} warning(s) were generated during document processing.`,
        spacing: {
          after: 24,
        },
      },
    },
  ];

  // Group warnings by component
  const warningsByComponent = new Map<string, GenerationWarning[]>();
  for (const warning of warnings) {
    const existing = warningsByComponent.get(warning.component) || [];
    existing.push(warning);
    warningsByComponent.set(warning.component, existing);
  }

  // Create sections for each component with warnings
  for (const [componentName, componentWarnings] of warningsByComponent.entries()) {
    children.push({
      name: 'heading',
      props: {
        level: 3,
        text: `Component: ${componentName}`,
      },
    });

    // Add each warning as a list item with details
    const warningItems: string[] = [];
    for (const warning of componentWarnings) {
      let warningText = warning.message;

      // Add context if present
      if (warning.context && Object.keys(warning.context).length > 0) {
        const contextStr = Object.entries(warning.context)
          .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
          .join(', ');
        warningText += ` (${contextStr})`;
      }

      warningItems.push(warningText);
    }

    children.push({
      name: 'list',
      props: {
        items: warningItems,
        spacing: {
          after: 12,
        },
      },
    });
  }

  return {
    name: 'report',
    props: {
      metadata: {
        title: 'Generation Warnings',
      },
      theme: 'minimal',
    },
    children,
  };
}

/**
 * Format warnings as plain text
 * Useful for logging or text output
 */
export function formatWarningsText(
  warnings: GenerationWarning[] | null
): string {
  if (!warnings || warnings.length === 0) {
    return 'No warnings generated.';
  }

  const lines: string[] = [
    `Document Generation Warnings (${warnings.length} total)`,
    '='.repeat(50),
    '',
  ];

  // Group by component
  const warningsByComponent = new Map<string, GenerationWarning[]>();
  for (const warning of warnings) {
    const existing = warningsByComponent.get(warning.component) || [];
    existing.push(warning);
    warningsByComponent.set(warning.component, existing);
  }

  for (const [componentName, componentWarnings] of warningsByComponent.entries()) {
    lines.push(`Component: ${componentName}`);
    lines.push('-'.repeat(30));

    for (let i = 0; i < componentWarnings.length; i++) {
      const warning = componentWarnings[i];
      lines.push(`  ${i + 1}. ${warning.message}`);

      if (warning.context && Object.keys(warning.context).length > 0) {
        lines.push(`     Context: ${JSON.stringify(warning.context, null, 2)}`);
      }
    }

    lines.push('');
  }

  return lines.join('\n');
}
