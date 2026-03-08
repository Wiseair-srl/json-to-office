export type RenderPptxPayload = {
  iframeSrc?: string;
  cleanup?: () => void;
};

/**
 * Render a PPTX blob as a PDF preview via server-side LibreOffice conversion.
 */
async function renderWithLibreOffice(
  baseUrl: string,
  name: string,
  file: Blob
): Promise<RenderPptxPayload> {
  const formData = new FormData();
  formData.append('file', file, `${name}.pptx`);

  const response = await fetch(`${baseUrl}/api/presentations/preview/libreoffice`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    let message = `LibreOffice preview failed (${response.status})`;
    try {
      const json = await response.json();
      if (json && typeof json === 'object' && typeof json.error === 'string') {
        message = json.error;
      }
    } catch {
      // Ignore JSON parse errors, keep fallback message.
    }
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

// Cleanup function for iframes
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

/**
 * Render a PPTX blob for preview. Uses LibreOffice PDF conversion on the server.
 * The blob is always available for direct download regardless of preview success.
 */
export async function renderPptx(
  name: string,
  blob: Blob,
  baseUrl: string
) {
  try {
    if (!blob || blob.size === 0) {
      throw new Error('Invalid or empty presentation blob');
    }

    const payload = await renderWithLibreOffice(baseUrl, name, blob);
    return { status: 'success' as const, name, payload };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { status: 'error' as const, name, payload: new Error(errorMessage) };
  }
}
