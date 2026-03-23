import { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronDown, Plus, Trash2, Pencil, Check, X } from 'lucide-react';
import { Button } from '../../ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';
import type { ChatThread } from '../../../store/chat-store';
import { defaultThreadTitle } from '../../../store/chat-store';

interface ChatThreadListProps {
  threads: ChatThread[];
  activeThread: ChatThread | undefined;
  disabled: boolean;
  onSwitch: (id: string) => void;
  onCreate: () => string | undefined;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
}

export function ChatThreadList({
  threads,
  activeThread,
  disabled,
  onSwitch,
  onCreate,
  onDelete,
  onRename,
}: ChatThreadListProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  const title = activeThread?.title || 'New Chat';
  const truncated = title.length > 24 ? title.slice(0, 24) + '...' : title;

  // Focus input when entering edit mode
  useEffect(() => {
    if (editingId) {
      // Small delay to let the input render
      requestAnimationFrame(() => editInputRef.current?.focus());
    }
  }, [editingId]);

  const startRename = useCallback((t: ChatThread, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setEditingId(t.id);
    setEditValue(t.title);
    setConfirmDeleteId(null);
  }, []);

  const commitRename = useCallback(() => {
    if (editingId && editValue.trim()) {
      onRename(editingId, editValue.trim());
    }
    setEditingId(null);
    setEditValue('');
  }, [editingId, editValue, onRename]);

  const cancelRename = useCallback(() => {
    setEditingId(null);
    setEditValue('');
  }, []);

  const handleEditKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        commitRename();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelRename();
      }
    },
    [commitRename, cancelRename]
  );

  const startDelete = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setConfirmDeleteId(id);
    setEditingId(null);
  }, []);

  const confirmDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (confirmDeleteId) {
        onDelete(confirmDeleteId);
        setConfirmDeleteId(null);
      }
    },
    [confirmDeleteId, onDelete]
  );

  const cancelDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setConfirmDeleteId(null);
  }, []);

  return (
    <div className="flex items-center gap-1">
      <DropdownMenu
        onOpenChange={(open) => {
          if (!open) {
            setEditingId(null);
            setConfirmDeleteId(null);
          }
        }}
      >
        <DropdownMenuTrigger asChild disabled={disabled}>
          <button className="flex items-center gap-1 text-sm font-semibold tracking-tight hover:text-foreground/80 transition-colors max-w-[180px] cursor-pointer">
            <div className="h-2 w-2 rounded-full bg-primary/70 shrink-0" />
            <span className="truncate">{truncated}</span>
            <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          {threads.map((t) => {
            const isEditing = editingId === t.id;
            const isConfirmingDelete = confirmDeleteId === t.id;

            if (isConfirmingDelete) {
              return (
                <div
                  key={t.id}
                  className="flex items-center gap-2 px-2 py-1.5 text-sm"
                >
                  <span className="text-red-400 text-xs flex-1 truncate">
                    Delete this thread?
                  </span>
                  <button
                    className="shrink-0 text-red-400 hover:text-red-300 transition-colors cursor-pointer"
                    onClick={confirmDelete}
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                  <button
                    className="shrink-0 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                    onClick={cancelDelete}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            }

            if (isEditing) {
              return (
                <div
                  key={t.id}
                  className="flex items-center gap-1.5 px-2 py-1"
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <input
                    ref={editInputRef}
                    type="text"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={handleEditKeyDown}
                    onBlur={commitRename}
                    className="flex-1 min-w-0 text-sm rounded border border-border bg-background px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-primary/40"
                  />
                  <button
                    className="shrink-0 text-primary hover:text-primary/80 transition-colors cursor-pointer"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      commitRename();
                    }}
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                  <button
                    className="shrink-0 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      cancelRename();
                    }}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            }

            return (
              <DropdownMenuItem
                key={t.id}
                onSelect={() => onSwitch(t.id)}
                className={`group ${t.id === activeThread?.id ? 'bg-accent' : ''}`}
              >
                <span className="truncate flex-1">
                  {t.title.length > 30 ? t.title.slice(0, 30) + '...' : t.title}
                </span>
                <div className="ml-auto shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    className="text-muted-foreground hover:text-foreground transition-colors p-0.5 cursor-pointer"
                    onClick={(e) => startRename(t, e)}
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  {threads.length > 1 && (
                    <button
                      className="text-muted-foreground hover:text-destructive transition-colors p-0.5 cursor-pointer"
                      onClick={(e) => startDelete(t.id, e)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              const id = onCreate();
              if (id) {
                setEditingId(id);
                setEditValue(defaultThreadTitle());
                setConfirmDeleteId(null);
              }
            }}
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            New Chat
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 text-muted-foreground hover:text-foreground"
        onClick={() => onCreate()}
        disabled={disabled}
        title="New chat thread"
      >
        <Plus className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
