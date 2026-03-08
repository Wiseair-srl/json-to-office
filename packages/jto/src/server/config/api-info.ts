import { config } from './index.js';

export async function getApiInfo() {
  return {
    name: 'JSON to Office API',
    version: '1.0.0',
    description: 'Generate DOCX and PPTX documents from JSON definitions',
    environment: config.NODE_ENV,
    endpoints: {
      health: '/health',
      api: '/api',
      generate: '/api/{format}/generate',
      validate: '/api/{format}/validate',
      discovery: '/api/discovery',
    },
  };
}
