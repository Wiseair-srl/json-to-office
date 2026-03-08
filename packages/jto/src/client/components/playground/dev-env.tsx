import { useCallback, useEffect, useState } from 'react';
import { DocumentSidebar } from './document-sidebar';
import { Editor } from './editor-lazy';
import { Preview } from './preview-lazy';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '../ui/resizable';
import { GlobalPreviewHeader } from './global-preview-header';
import type { DiscoveryResult } from '../../hooks/useDiscovery';

export function DevEnv({
  discoveryData,
}: {
  discoveryData: DiscoveryResult | null;
}) {
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem('dev-env.sidebar-open');
      return stored ? stored === 'true' : true;
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('dev-env.sidebar-open', String(sidebarOpen));
    } catch {
      // Silently ignore localStorage errors (e.g., in private browsing mode)
    }
  }, [sidebarOpen]);

  const toggleSidebar = useCallback(() => setSidebarOpen((v) => !v), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isMeta = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (isMeta && key === 'b') {
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleSidebar]);

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* Fixed-width, collapsible sidebar (no overlay) */}
      <div
        className={`shrink-0 transition-all duration-200 ease-linear ${sidebarOpen ? 'w-64' : 'w-10'} border-r`}
      >
        <DocumentSidebar
          discoveryData={discoveryData}
          onToggleSidebar={toggleSidebar}
          isCollapsed={!sidebarOpen}
        />
      </div>
      {/* Main editor/preview area with resizable split */}
      <div className="flex-1 min-w-0 flex flex-col h-full">
        <GlobalPreviewHeader />
        <ResizablePanelGroup
          direction="horizontal"
          autoSaveId="layout-main"
          className="flex-1 min-h-0"
        >
          <ResizablePanel defaultSize={50} minSize={20} id="editor" order={1}>
            <Editor />
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={50} minSize={20} id="preview" order={2}>
            <Preview />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}
