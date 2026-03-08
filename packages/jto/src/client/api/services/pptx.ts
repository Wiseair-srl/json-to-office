import { apiClient } from '../client';
import { FORMAT } from '../../lib/env';

export interface GenerateDocumentRequest {
  code: string;
}

export interface GenerateDocumentResponse {
  blob: Blob;
}

const formatMime =
  FORMAT === 'pptx'
    ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export const pptxService = {
  async generate(code: string): Promise<Blob> {
    const formData = new FormData();
    formData.append('code', code);

    const response = await apiClient.post<Blob>(
      `/api/${FORMAT}/generate`,
      formData,
      {
        responseType: 'blob',
        headers: { 'Content-Type': formatMime },
      }
    );

    return response.data;
  },
};

// Alias for format-agnostic usage
export const documentService = pptxService;
