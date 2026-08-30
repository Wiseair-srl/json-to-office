import React, { useCallback } from 'react';
import { useOutputStore } from '../../store/output-store-provider';
import { useSettingsStore } from '../../store/settings-store-provider';
import { PreviewHeaderMemoized } from './preview-header';
import { SchemaDialog } from './schema-dialog';
import { FontPickerDialog } from './font-picker-dialog';
import { useFontPickerStore } from '../../store/font-picker-store';
import { useDocumentsStore } from '../../store/documents-store-provider';
import { useChatStore } from '../../store/chat-store-provider';

const noop = () => {};

export function GlobalPreviewHeader({
  previewOpen,
  onTogglePreview,
}: {
  previewOpen?: boolean;
  onTogglePreview?: () => void;
}) {
  // Select fields individually to avoid creating new objects every render
  const name = useOutputStore((s) => s.name || '');
  const blob = useOutputStore((s) => s.blob);
  const isGenerating = useOutputStore((s) => s.isGenerating);
  const text = useOutputStore((s) => s.text);
  const warnings = useOutputStore((s) => s.warnings);
  const isRendering = useOutputStore((s) => s.isRendering);

  const useGlobalPreviewHeader = useSettingsStore(
    (s: any) => s.useGlobalPreviewHeader ?? true
  );

  const activeTab = useDocumentsStore((s) => s.activeTab);
  const documentTypes = useDocumentsStore((s) => s.documentTypes);
  const activeDocumentType =
    activeTab && documentTypes[activeTab] === 'application/json+theme'
      ? 'theme'
      : 'document';
  // The editor's active document text (not the last generated output) so
  // "Copy standard components" works before the first Run (#155). Themes are
  // excluded — they have no standard-components expansion. The selector
  // returns a string, so Zustand's equality check keeps renders cheap.
  const editorDocumentText = useDocumentsStore((s) =>
    s.activeTab && s.documentTypes[s.activeTab] !== 'application/json+theme'
      ? s.documents.find((d) => d.name === s.activeTab)?.text
      : undefined
  );
  // The name owning that text. `name` above is the last output's, so without
  // this the copy request pairs one document's JSON with another's provenance.
  const editorDocumentName = useDocumentsStore((s) =>
    s.activeTab && s.documentTypes[s.activeTab] !== 'application/json+theme'
      ? s.activeTab
      : undefined
  );

  const chatOpen = __AI_ENABLED__ ? useChatStore((s) => s.chatOpen) : false;

  const toggleChat = __AI_ENABLED__ ? useChatStore((s) => s.toggleChat) : noop;

  const [schemaOpen, setSchemaOpen] = React.useState(false);
  // Font picker open state now lives in the shared store so Monaco CodeLens
  // can open it in contextual mode from anywhere in the app.
  const openFontPicker = useFontPickerStore((s) => s.openFor);

  if (!useGlobalPreviewHeader) return null;

  const onManualRender = useCallback(() => {
    window.dispatchEvent(new CustomEvent('preview:manualRender'));
  }, []);

  const onShowCacheMetrics = useCallback(() => {
    window.dispatchEvent(new CustomEvent('preview:showCacheMetrics'));
  }, []);

  // Render a full-width header that spans the entire main area
  // Use the previewed document name for header and download filename
  // to avoid using the active theme's name when editing themes.
  const displayName = name?.trim() || 'Preview';

  return (
    <div className="sticky top-0 z-20">
      <PreviewHeaderMemoized
        name={displayName}
        blob={blob}
        onManualRender={onManualRender}
        isGenerating={isGenerating}
        isRendering={Boolean(isRendering)}
        onShowCacheMetrics={onShowCacheMetrics}
        onShowSchemas={() => setSchemaOpen(true)}
        onShowFonts={() => openFontPicker()}
        documentText={text}
        editorDocumentText={editorDocumentText}
        editorDocumentName={editorDocumentName}
        warnings={warnings}
        onToggleChat={__AI_ENABLED__ ? toggleChat : undefined}
        chatOpen={__AI_ENABLED__ ? chatOpen : undefined}
        onTogglePreview={onTogglePreview}
        previewOpen={previewOpen}
      />
      <SchemaDialog
        open={schemaOpen}
        onOpenChange={setSchemaOpen}
        defaultTab={activeDocumentType === 'theme' ? 'theme' : 'document'}
      />
      <FontPickerDialog />
    </div>
  );
}
