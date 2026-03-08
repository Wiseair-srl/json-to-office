import type { GenerationWarning } from '../store/output-store';

/**
 * Build a presentation definition from generation warnings
 * This mirrors the backend generateWarningsDocument function
 */
export function buildWarningsDocumentJson(
  warnings: GenerationWarning[] | null
): any | null {
  if (!warnings || warnings.length === 0) {
    return null;
  }

  const children: any[] = [
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
          after: 240,
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
  for (const [
    componentName,
    componentWarnings,
  ] of warningsByComponent.entries()) {
    children.push({
      name: 'heading',
      props: {
        level: 2,
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
          after: 120,
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
