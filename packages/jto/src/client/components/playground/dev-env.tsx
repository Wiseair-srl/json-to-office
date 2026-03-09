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
import { ChatPanel } from './ai-chat';
import { useChatStore } from '../../store/chat-store-provider';
import { ChatSessionProvider } from '../../store/chat-session-provider';
import type { DiscoveryResult } from '../../hooks/useDiscovery';

export function DevEnv({
  discoveryData,
}: {
  discoveryData: DiscoveryResult | null;
}) {
  const chatOpen = useChatStore((s) => s.chatOpen);
  const toggleChat = useChatStore((s) => s.toggleChat);

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
      if (isMeta && key === 'l') {
        e.preventDefault();
        toggleChat();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleSidebar, toggleChat]);

  return (
    <ChatSessionProvider>
      <div className="flex h-full w-full overflow-hidden">
        {/* Fixed-width, collapsible sidebar — slightly darker surface */}
        <div
          className={`shrink-0 transition-all duration-200 ease-linear ${sidebarOpen ? 'w-64' : 'w-10'} border-r bg-sidebar`}
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
              <div className="h-full bg-surface-editor">
                <Editor />
              </div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={50} minSize={20} id="preview" order={2}>
              <div className="h-full bg-surface-preview">
                <Preview />
              </div>
            </ResizablePanel>
            {chatOpen && (
              <>
                <ResizableHandle withHandle />
                <ResizablePanel
                  defaultSize={30}
                  minSize={20}
                  maxSize={50}
                  id="chat"
                  order={3}
                >
                  <ChatPanel />
                </ResizablePanel>
              </>
            )}
          </ResizablePanelGroup>
        </div>
      </div>
    </ChatSessionProvider>
  );
}
