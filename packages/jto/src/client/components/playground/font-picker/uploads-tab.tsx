import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { Button } from '../../ui/button';
import { useToast } from '../../ui/use-toast';
import { parseFontFilename } from '../../../lib/font-filename';
import {
  deleteUserFont,
  listUserFonts,
  makeUserFontId,
  saveUserFont,
  type StoredUserFont,
  type UserFontFormat,
} from '../../../lib/user-fonts-storage';

/**
 * View-layer shape handed back to the parent FontPickerDialog so it can render
 * each upload through its shared FontCard. Keeps the parent in control of
 * per-card action buttons (heading/body/contextual) while this component owns
 * the IDB + FontFace lifecycle.
 */
export interface StoredUserFontView extends StoredUserFont {
  onDelete: () => void;
}

interface UploadsTabProps {
  search: string;
  filtered: StoredUserFontView[];
  onListChange: (uploads: StoredUserFontView[]) => void;
  renderCard: (upload: StoredUserFontView) => React.ReactNode;
}

const ALLOWED_EXT = /\.(ttf|otf)$/i;

export const UploadsTab: React.FC<UploadsTabProps> = ({
  search,
  filtered,
  onListChange,
  renderCard,
}) => {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  /** FontFace handles that we register with document.fonts so previews render. */
  const faceHandlesRef = useRef<Map<string, { face: FontFace; url: string }>>(
    new Map()
  );

  const registerPreview = useCallback(async (font: StoredUserFont) => {
    if (faceHandlesRef.current.has(font.id)) return;
    try {
      const blob = new Blob([font.data], {
        type: font.format === 'otf' ? 'font/otf' : 'font/ttf',
      });
      const url = URL.createObjectURL(blob);
      const face = new FontFace(font.family, `url(${url})`, {
        weight: String(font.weight),
        style: font.italic ? 'italic' : 'normal',
      });
      await face.load();
      document.fonts.add(face);
      faceHandlesRef.current.set(font.id, { face, url });
    } catch (err) {
      // Non-fatal — the card still renders with a fallback font.
      console.warn('Failed to register uploaded font preview:', err);
    }
  }, []);

  const unregisterPreview = useCallback((id: string) => {
    const handle = faceHandlesRef.current.get(id);
    if (!handle) return;
    try {
      document.fonts.delete(handle.face);
    } catch {
      // document.fonts.delete can throw on some implementations — ignore.
    }
    URL.revokeObjectURL(handle.url);
    faceHandlesRef.current.delete(id);
  }, []);

  const refreshList = useCallback(async () => {
    const fonts = await listUserFonts();
    for (const f of fonts) registerPreview(f);
    const views: StoredUserFontView[] = fonts.map((f) => ({
      ...f,
      onDelete: async () => {
        unregisterPreview(f.id);
        await deleteUserFont(f.id);
        refreshList();
      },
    }));
    onListChange(views);
  }, [onListChange, registerPreview, unregisterPreview]);

  useEffect(() => {
    refreshList();
    const faceHandles = faceHandlesRef.current;
    return () => {
      // Revoke object URLs on unmount; keep FontFace registered — the browser
      // already cached the data, and the next open reuses the same family.
      for (const handle of faceHandles.values()) {
        URL.revokeObjectURL(handle.url);
      }
      faceHandles.clear();
    };
    // Mount-only: refreshList wraps useCallback so its identity is stable.
  }, []); // eslint-disable-line

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      if (list.length === 0) return;
      setIsUploading(true);
      let accepted = 0;
      let rejected = 0;
      try {
        for (const file of list) {
          if (!ALLOWED_EXT.test(file.name)) {
            rejected++;
            continue;
          }
          const buffer = await file.arrayBuffer();
          const { family, weight, italic } = parseFontFilename(file.name);
          const format: UserFontFormat = file.name
            .toLowerCase()
            .endsWith('.otf')
            ? 'otf'
            : 'ttf';
          const id = makeUserFontId(family, weight, italic);
          await saveUserFont({
            id,
            family,
            weight,
            italic,
            format,
            data: buffer,
            addedAt: Date.now(),
          });
          accepted++;
        }
        if (accepted > 0) {
          toast({
            title: 'Font uploaded',
            description: `${accepted} font${accepted === 1 ? '' : 's'} added to this browser.`,
          });
        }
        if (rejected > 0) {
          toast({
            variant: 'destructive',
            title: 'Unsupported file type',
            description: `${rejected} file${rejected === 1 ? '' : 's'} skipped — Office embedding requires TTF or OTF.`,
          });
        }
        await refreshList();
      } finally {
        setIsUploading(false);
      }
    },
    [refreshList, toast]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer?.files) handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  return (
    <div className="flex flex-col gap-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
        }}
        className={`flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed p-8 text-sm text-muted-foreground cursor-pointer transition-colors ${
          isDragging ? 'border-primary bg-primary/5' : 'border-muted'
        }`}
      >
        <Upload className="h-6 w-6" />
        <div className="font-medium text-foreground">
          {isUploading ? 'Uploading…' : 'Drop TTF or OTF files here'}
        </div>
        <div className="text-xs">
          or click to select. Uploads stay on this device — clearing site data
          removes them.
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".ttf,.otf"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) handleFiles(e.target.files);
            if (inputRef.current) inputRef.current.value = '';
          }}
        />
      </div>

      {filtered.length === 0 ? (
        <div className="text-sm text-muted-foreground text-center py-6">
          {search
            ? 'No uploaded fonts match the search.'
            : 'Uploaded fonts are browser-local. They embed automatically on generate.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map(renderCard)}
        </div>
      )}
    </div>
  );
};

/** Re-export for Button prop forwarding on empty state CTAs if needed elsewhere. */
export { Button as UploadsButton };
