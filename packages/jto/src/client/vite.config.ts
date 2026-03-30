import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  root: path.resolve(__dirname, '.'),
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      '/api/services': path.resolve(__dirname, './api/services'),
    },
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom'],
  },
  css: {
    modules: {
      localsConvention: 'camelCase',
    },
  },
  server: {
    port: 3001,
    open: process.env.OPEN_BROWSER === 'true',
  },
  build: {
    outDir: '../../dist/client',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (!id.includes('node_modules')) return;
          if (id.includes('monaco-editor')) return 'monaco-editor';
          if (
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/') ||
            id.includes('node_modules/react-router') ||
            id.includes('node_modules/scheduler/')
          )
            return 'react-vendor';
          if (
            id.includes('lucide-react') ||
            id.includes('clsx') ||
            id.includes('class-variance-authority')
          )
            return 'ui-vendor';
          if (id.includes('@tanstack/react-query') || id.includes('axios'))
            return 'query-vendor';
          if (id.includes('@radix-ui')) return 'radix-ui';
          if (id.includes('zustand')) return 'state-vendor';
          if (id.includes('docx-preview')) return 'docx-preview';
        },
        chunkFileNames: () => 'assets/[name]-[hash].js',
      },
    },
    chunkSizeWarningLimit: 500,
  },
});
