import { useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useDocumentsStore } from '../../store/documents-store-provider';
import { useThemesStore } from '../../store/themes-store-provider';
import { FORMAT } from '../../lib/env';

// Theme names registered in the server-side core packages. Documents may
// reference these even without a matching customThemes entry.
const BUILTIN_THEMES: Record<string, readonly string[]> = {
  pptx: ['default', 'dark', 'minimal'],
  docx: ['minimal', 'corporate', 'modern'],
};

export function UnavailableThemeWarning({ className }: { className?: string }) {
  const activeTab = useDocumentsStore((s) => s.activeTab);
  const documentTypes = useDocumentsStore((s) => s.documentTypes);
  const documents = useDocumentsStore((s) => s.documents);
  const customThemes = useThemesStore((s) => s.customThemes);

  const missingThemeName = useMemo(() => {
    if (!activeTab) return null;
    if (documentTypes[activeTab] === 'application/json+theme') return null;

    const doc = documents.find((d) => d.name === activeTab);
    if (!doc?.text) return null;

    let themeName: unknown;
    try {
      themeName = JSON.parse(doc.text)?.props?.theme;
    } catch {
      return null;
    }
    if (typeof themeName !== 'string' || !themeName) return null;

    if (BUILTIN_THEMES[FORMAT]?.includes(themeName)) return null;

    for (const ct of Object.values(customThemes)) {
      if (ct.valid && ct.name === themeName) return null;
    }

    return themeName;
  }, [activeTab, documentTypes, documents, customThemes]);

  if (!missingThemeName) return null;

  return (
    <div
      className={`flex items-start gap-2 rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/50 px-3 py-2 ${className ?? ''}`}
    >
      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 text-amber-500 flex-shrink-0" />
      <div className="flex-1 min-w-0 text-xs leading-relaxed">
        <span className="font-medium text-amber-700 dark:text-amber-300">
          Theme{' '}
          <code className="bg-amber-100 dark:bg-amber-900/40 px-1 py-0.5 rounded">
            {missingThemeName}
          </code>{' '}
          is not available.
        </span>{' '}
        <span className="text-amber-700/80 dark:text-amber-300/80">
          Add it as a custom theme or use a built-in theme (
          {BUILTIN_THEMES[FORMAT]?.join(', ')}). The renderer will fall back to
          a default.
        </span>
      </div>
    </div>
  );
}
