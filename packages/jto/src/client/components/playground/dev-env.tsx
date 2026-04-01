import { useCallback, useEffect, useRef, useState } from 'react';
import { PanelLeftOpen, Code2, Eye, MessageSquare } from 'lucide-react';
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
import { useIsMobile, useIsNarrow } from '../../hooks/use-mobile';
import { Sheet, SheetContent, SheetTrigger } from '../ui/sheet';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import type { DiscoveryResult } from '../../hooks/useDiscovery';

// Compile-time constant: __AI_ENABLED__ is replaced by Vite at build time.
// The conditional hook calls below are safe because the branch never changes at runtime.
const noop = () => {};

type MobilePanel = 'editor' | 'preview' | 'chat';

export function DevEnv({
  discoveryData,
}: {
  discoveryData: DiscoveryResult | null;
}) {
  const isMobile = useIsMobile();
  const isNarrow = useIsNarrow();

  const chatOpen = __AI_ENABLED__ ? useChatStore((s) => s.chatOpen) : false;

  const toggleChat = __AI_ENABLED__ ? useChatStore((s) => s.toggleChat) : noop;

  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem('dev-env.sidebar-open');
      return stored ? stored === 'true' : true;
    } catch {
      return true;
    }
  });

  const [previewOpen, setPreviewOpen] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem('dev-env.preview-open');
      return stored ? stored === 'true' : true;
    } catch {
      return true;
    }
  });

  const [mobilePanel, setMobilePanel] = useState<MobilePanel>('editor');
  const [sheetOpen, setSheetOpen] = useState(false);

  // Stagger content swap: content fades out → width animates → content fades in
  const CONTENT_FADE_MS = 120;
  const [contentCollapsed, setContentCollapsed] = useState(!sidebarOpen);
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem('dev-env.sidebar-open', String(sidebarOpen));
    } catch {
      // Silently ignore localStorage errors (e.g., in private browsing mode)
    }
  }, [sidebarOpen]);

  useEffect(() => {
    try {
      localStorage.setItem('dev-env.preview-open', String(previewOpen));
    } catch {}
  }, [previewOpen]);

  // Auto-collapse sidebar on narrow viewports
  const prevNarrowRef = useRef(isNarrow);
  useEffect(() => {
    if (isNarrow && !prevNarrowRef.current && sidebarOpen) {
      setIsAnimating(true);
      setTimeout(() => {
        setSidebarOpen(false);
        setContentCollapsed(true);
      }, CONTENT_FADE_MS);
    }
    if (!isNarrow && prevNarrowRef.current && !sidebarOpen) {
      setIsAnimating(true);
      setTimeout(() => {
        setSidebarOpen(true);
        setContentCollapsed(false);
      }, CONTENT_FADE_MS);
    }
    prevNarrowRef.current = isNarrow;
  }, [isNarrow, sidebarOpen]);

  const toggleSidebar = useCallback(() => {
    if (isMobile) {
      setSheetOpen((v) => !v);
      return;
    }
    // 1. Start fade-out
    setIsAnimating(true);
    // 2. After content fades out, swap layout + start width animation
    setTimeout(() => {
      setSidebarOpen((v) => !v);
      setContentCollapsed((v) => !v);
    }, CONTENT_FADE_MS);
  }, [isMobile]);
  const togglePreview = useCallback(() => setPreviewOpen((v) => !v), []);

  // Use refs so the keydown listener never goes stale
  const toggleChatRef = useRef(toggleChat);
  const toggleSidebarRef = useRef(toggleSidebar);
  const togglePreviewRef = useRef(togglePreview);
  useEffect(() => {
    toggleChatRef.current = toggleChat;
  });
  useEffect(() => {
    toggleSidebarRef.current = toggleSidebar;
  });
  useEffect(() => {
    togglePreviewRef.current = togglePreview;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isMeta = e.metaKey || e.ctrlKey;
      if (!isMeta) return;
      if (e.code === 'KeyB' && !e.shiftKey) {
        e.preventDefault();
        toggleSidebarRef.current();
      }
      if (e.code === 'KeyJ' && e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        toggleChatRef.current();
      }
      if (e.code === 'KeyP' && e.shiftKey) {
        e.preventDefault();
        togglePreviewRef.current();
      }
    };
    window.addEventListener('keydown', onKey, true); // capture phase
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const AiWrapper = __AI_ENABLED__
    ? ChatSessionProvider
    : ({ children }: { children: React.ReactNode }) => <>{children}</>;

  const mobileTabs: { key: MobilePanel; icon: typeof Code2; label: string }[] =
    [
      { key: 'editor', icon: Code2, label: 'Editor' },
      { key: 'preview', icon: Eye, label: 'Preview' },
      ...(__AI_ENABLED__
        ? [{ key: 'chat' as const, icon: MessageSquare, label: 'Chat' }]
        : []),
    ];

  // Mobile layout: Sheet sidebar + tabbed panels
  if (isMobile) {
    return (
      <AiWrapper>
        <div className="flex flex-col h-full w-full overflow-hidden">
          {/* Mobile header: sidebar trigger + panel tabs */}
          <div className="flex items-center gap-1 px-2 py-1.5 border-b bg-sidebar shrink-0">
            <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                >
                  <PanelLeftOpen className="h-4 w-4" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="p-0 w-72">
                <DocumentSidebar
                  discoveryData={discoveryData}
                  onToggleSidebar={() => setSheetOpen(false)}
                  isCollapsed={false}
                />
              </SheetContent>
            </Sheet>

            <div className="flex gap-0.5 flex-1 min-w-0">
              {mobileTabs.map(({ key, icon: Icon, label }) => (
                <Button
                  key={key}
                  variant={mobilePanel === key ? 'default' : 'ghost'}
                  size="sm"
                  className="h-7 gap-1.5 text-xs flex-1"
                  onClick={() => setMobilePanel(key)}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span className="hidden xs:inline">{label}</span>
                </Button>
              ))}
            </div>
          </div>

          {/* Toolbar — only show when not in chat */}
          {mobilePanel !== 'chat' && (
            <GlobalPreviewHeader
              previewOpen={previewOpen}
              onTogglePreview={togglePreview}
            />
          )}

          {/* Active panel */}
          <div className="flex-1 min-h-0">
            {mobilePanel === 'editor' && (
              <div className="h-full bg-surface-editor">
                <Editor />
              </div>
            )}
            {mobilePanel === 'preview' && (
              <div className="h-full bg-surface-preview">
                <Preview />
              </div>
            )}
            {__AI_ENABLED__ && mobilePanel === 'chat' && <ChatPanel />}
          </div>
        </div>
      </AiWrapper>
    );
  }

  // Desktop layout
  return (
    <AiWrapper>
      <div className="flex h-full w-full overflow-hidden">
        {/* Fixed-width, collapsible sidebar */}
        <div
          className={cn(
            'shrink-0 overflow-hidden border-r bg-sidebar',
            'transition-[width] duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)]',
            sidebarOpen ? 'w-64' : 'w-10'
          )}
          onTransitionEnd={(e) => {
            // Only react to width transitions on this element
            if (e.propertyName === 'width' && e.target === e.currentTarget) {
              setIsAnimating(false);
            }
          }}
        >
          <DocumentSidebar
            discoveryData={discoveryData}
            onToggleSidebar={toggleSidebar}
            isCollapsed={contentCollapsed}
            isAnimating={isAnimating}
          />
        </div>
        {/* Main editor/preview area with resizable split */}
        <div className="flex-1 min-w-0 flex flex-col h-full">
          <GlobalPreviewHeader
            previewOpen={previewOpen}
            onTogglePreview={togglePreview}
          />
          <ResizablePanelGroup
            direction="horizontal"
            autoSaveId="layout-main"
            className="flex-1 min-h-0"
          >
            <ResizablePanel
              defaultSize={previewOpen ? 50 : 100}
              minSize={20}
              id="editor"
              order={1}
            >
              <div className="h-full bg-surface-editor">
                <Editor />
              </div>
            </ResizablePanel>
            {previewOpen && (
              <>
                <ResizableHandle withHandle />
                <ResizablePanel
                  defaultSize={50}
                  minSize={20}
                  id="preview"
                  order={2}
                >
                  <div className="h-full bg-surface-preview">
                    <Preview />
                  </div>
                </ResizablePanel>
              </>
            )}
            {__AI_ENABLED__ && chatOpen && (
              <>
                <ResizableHandle withHandle />
                <ResizablePanel
                  defaultSize={30}
                  minSize={25}
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
    </AiWrapper>
  );
}
