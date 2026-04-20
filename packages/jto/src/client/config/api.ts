import { FORMAT } from '../lib/env';

export const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

// Format-specific API prefix
const FORMAT_API = `${API_BASE_URL}/${FORMAT}`;

export const API_ENDPOINTS = {
  discovery: {
    all: `${API_BASE_URL}/discovery/all`,
    plugins: `${API_BASE_URL}/discovery/plugins`,
    documents: `${API_BASE_URL}/discovery/documents`,
    themes: `${API_BASE_URL}/discovery/themes`,
    schemas: {
      document: `${API_BASE_URL}/discovery/schemas/document`,
      theme: `${API_BASE_URL}/discovery/schemas/theme`,
    },
  },
  generate: `${FORMAT_API}/generate`,
  validate: `${FORMAT_API}/validate`,
  preview: {
    libreoffice: `${FORMAT_API}/preview/libreoffice`,
    libreofficeFromJson: `${FORMAT_API}/preview/libreoffice-from-json`,
  },
  cacheStats: `${FORMAT_API}/cache-stats`,
};
