import { FORMAT } from './env';
import { API_ENDPOINTS } from '../config/api';
import { env } from './env';

export type RenderPayload = {
  iframeSrc?: string;
  iframeSrcDoc?: string;
  cleanup?: () => void;
};

async function renderDocxWithDocxJS(blob: Blob): Promise<RenderPayload> {
  const docx_preview = await import('docx-preview');

  const bodyEl = document.createElement('body');
  const headEl = document.createElement('head');

  const renderPromise = docx_preview.renderAsync(blob, bodyEl, headEl, {
    inWrapper: true,
  });

  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error('DocxJS renderAsync timed out after 10 seconds'));
    }, 10000);
  });

  await Promise.race([renderPromise, timeoutPromise]);

  const overrideStyleEl = document.createElement('link');
  overrideStyleEl.rel = 'stylesheet';
  overrideStyleEl.href = `${env.basePath}/css/preview/docxjs.css`;
  headEl.appendChild(overrideStyleEl);

  const htmlEl = document.createElement('html');
  htmlEl.appendChild(headEl);
  htmlEl.appendChild(bodyEl);

  return {
    iframeSrcDoc: htmlEl.outerHTML,
  };
}

async function renderWithLibreOffice(
  name: string,
  blob: Blob
): Promise<RenderPayload> {
  const formData = new FormData();
  const ext = FORMAT === 'pptx' ? '.pptx' : '.docx';
  formData.append('file', blob, `${name}${ext}`);

  const response = await fetch(API_ENDPOINTS.preview.libreoffice, {
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

export type RenderLibrary = 'docxjs' | 'LibreOffice';

export async function renderDocument(
  name: string,
  blob: Blob,
  library: RenderLibrary = FORMAT === 'docx' ? 'docxjs' : 'LibreOffice',
  _baseUrl?: string,
) {
  try {
    if (!blob || blob.size === 0) {
      throw new Error('Invalid or empty document blob');
    }

    let payload: RenderPayload;

    if (FORMAT === 'docx' && library === 'docxjs') {
      payload = await renderDocxWithDocxJS(blob);
    } else {
      payload = await renderWithLibreOffice(name, blob);
    }

    return { status: 'success' as const, name, payload };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { status: 'error' as const, name, payload: new Error(errorMessage) };
  }
}

// Keep backward compat exports for pptx code
export const renderPptx = (name: string, blob: Blob, baseUrl: string) =>
  renderDocument(name, blob, 'LibreOffice', baseUrl);
