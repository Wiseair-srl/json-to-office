import { FORMAT } from './env';
import { API_ENDPOINTS } from '../config/api';

export type RenderPayload = {
  iframeSrc?: string;
  iframeSrcDoc?: string;
  cleanup?: () => void;
};

async function renderWithLibreOffice(
  name: string,
  blob: Blob,
  jsonText?: string,
  customThemes?: Record<string, unknown>,
  renderer?: string,
  sourceName?: string
): Promise<RenderPayload> {
  // When we know the source JSON, hit the from-json endpoint. The server
  // generates + converts in one step and passes resolved fonts directly to
  // the LibreOffice font stager — embedded fonts render correctly in the PDF.
  // Falling back to the upload path is still useful if the JSON is lost or
  // we're previewing an externally-supplied file.
  const useJsonPath = typeof jsonText === 'string' && jsonText.length > 0;

  let response: Response;
  if (useJsonPath) {
    let jsonDefinition: unknown;
    try {
      jsonDefinition = JSON.parse(jsonText!);
    } catch (err) {
      throw new Error(`Invalid JSON document: ${(err as Error).message}`);
    }
    const body: Record<string, unknown> = {
      jsonDefinition,
      customThemes: customThemes ?? {},
      // sourceName lets the server resolve relative asset paths against the
      // discovered document's own directory (#142). Names only — the server
      // maps them to paths itself. Callers pass the document's template
      // provenance when they know it; the display name is only the fallback.
      //
      // `renderer` is what keeps the preview honest: the server regenerates
      // the document here, and without it the PDF on screen came from the
      // default backend while the download came from the selected one (#255).
      options: {
        sourceName: sourceName ?? name,
        ...(renderer ? { renderer } : {}),
      },
    };
    response = await fetch(API_ENDPOINTS.preview.libreofficeFromJson, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } else {
    const formData = new FormData();
    const ext = FORMAT === 'pptx' ? '.pptx' : '.docx';
    formData.append('file', blob, `${name}${ext}`);
    response = await fetch(API_ENDPOINTS.preview.libreoffice, {
      method: 'POST',
      body: formData,
    });
  }

  if (!response.ok) {
    let message = `LibreOffice preview failed (${response.status})`;
    try {
      const json = await response.json();
      if (json && typeof json === 'object' && typeof json.error === 'string') {
        message = json.error;
      }
    } catch {}
    throw new Error(message);
  }

  const pdfBlob = await response.blob();
  if (!pdfBlob.size) {
    throw new Error('LibreOffice preview returned an empty PDF');
  }

  const objectUrl = URL.createObjectURL(pdfBlob);
  return {
    iframeSrc: objectUrl,
    cleanup: () => URL.revokeObjectURL(objectUrl),
  };
}

export function cleanupIframe(iframe: HTMLIFrameElement) {
  try {
    if (iframe.contentWindow) {
      iframe.contentWindow.location.replace('about:blank');
    }
    iframe.src = 'about:blank';
    iframe.srcdoc = '';
    if (iframe.parentNode) {
      iframe.parentNode.removeChild(iframe);
    }
  } catch (error) {
    console.warn('Error cleaning up iframe:', error);
  }
}

export async function renderDocument(
  name: string,
  blob: Blob,
  jsonText?: string,
  customThemes?: Record<string, unknown>,
  renderer?: string,
  sourceName?: string
) {
  try {
    if (!blob || blob.size === 0) {
      throw new Error('Invalid or empty document blob');
    }

    const payload = await renderWithLibreOffice(
      name,
      blob,
      jsonText,
      customThemes,
      renderer,
      sourceName
    );

    return { status: 'success' as const, name, payload };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { status: 'error' as const, name, payload: new Error(errorMessage) };
  }
}

// Keep backward compat exports for pptx code
export const renderPptx = (name: string, blob: Blob) =>
  renderDocument(name, blob);
