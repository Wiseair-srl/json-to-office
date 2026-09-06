import { useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useDocumentsStore } from '../../store/documents-store-provider';
import { useThemesStore } from '../../store/themes-store-provider';
import { FORMAT } from '../../lib/env';

// Theme names registered in the server-side core packages. Documents may
// reference these even without a matching customThemes entry.
const BUILTIN_THEMES: Record<string, readonly string[]> = {
  pptx: ['default', 'dark', 'minimal', 'consulting'],
  docx: ['minimal', 'devportal', 'vermilion', 'consulting'],
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
      className={`flex items-start gap-2 rounded-sm border border-transparent bg-warning/10 px-3 py-2 ${className ?? ''}`}
    >
      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 text-warning flex-shrink-0" />
      <div className="flex-1 min-w-0 text-xs leading-relaxed">
        <span className="font-medium text-warning">
          Theme{' '}
          <code className="bg-warning/20 px-1 py-0.5 rounded-sm text-warning">
            {missingThemeName}
          </code>{' '}
          is not available.
        </span>{' '}
        <span className="text-warning/80">
          Add it as a custom theme or use a built-in theme (
          {BUILTIN_THEMES[FORMAT]?.join(', ')}). The renderer will fall back to
          a default.
        </span>
      </div>
    </div>
  );
}
