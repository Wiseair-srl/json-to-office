import React, { useCallback } from 'react';
import { useOutputStore } from '../../store/output-store-provider';
import { useSettingsStore } from '../../store/settings-store-provider';
import { PreviewHeaderMemoized } from './preview-header';
import { SchemaDialog } from './schema-dialog';
import { useDocumentsStore } from '../../store/documents-store-provider';
import { useChatStore } from '../../store/chat-store-provider';

export function GlobalPreviewHeader() {
  // Select fields individually to avoid creating new objects every render
  const name = useOutputStore((s) => s.name || '');
  const blob = useOutputStore((s) => s.blob);
  const isGenerating = useOutputStore((s) => s.isGenerating);
  const text = useOutputStore((s) => s.text);
  const warnings = useOutputStore((s) => s.warnings);
  const isRendering = useOutputStore((s) => s.isRendering);

  const autoReload = useSettingsStore((s) => s.autoReload);
  const renderingLibrary = useSettingsStore((s) => s.renderingLibrary);
  const setSettings = useSettingsStore((s) => s.setSettings);
  const useGlobalPreviewHeader = useSettingsStore(
    (s: any) => s.useGlobalPreviewHeader ?? true
  );

  const activeTab = useDocumentsStore((s) => s.activeTab);
  const documentTypes = useDocumentsStore((s) => s.documentTypes);
  const activeDocumentType =
    activeTab && documentTypes[activeTab] === 'application/json+theme'
      ? 'theme'
      : 'document';

  const chatOpen = useChatStore((s) => s.chatOpen);
  const toggleChat = useChatStore((s) => s.toggleChat);

  const [schemaOpen, setSchemaOpen] = React.useState(false);

  if (!useGlobalPreviewHeader) return null;

  const onToggleAutoReload = useCallback(
    () =>
      setSettings({
        saveDocumentDebounceWait: 2000,
        autoReload: !autoReload,
      } as any),
    [autoReload, setSettings]
  );

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
        displayReloadButton={false}
        autoReload={autoReload}
        onToggleAutoReload={onToggleAutoReload}
        onManualRender={onManualRender}
        isGenerating={isGenerating}
        isRendering={Boolean(isRendering)}
        onShowCacheMetrics={onShowCacheMetrics}
        onShowSchemas={() => setSchemaOpen(true)}
        documentText={text}
        warnings={warnings}
        renderingLibrary={renderingLibrary}
        setRenderingLibrary={(lib) => setSettings({ renderingLibrary: lib } as any)}
        onToggleChat={toggleChat}
        chatOpen={chatOpen}
      />
      <SchemaDialog
        open={schemaOpen}
        onOpenChange={setSchemaOpen}
        defaultTab={activeDocumentType === 'theme' ? 'theme' : 'document'}
      />
    </div>
  );
}
