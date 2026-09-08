import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { audoraApi } from './server/api.ts';

// Keys are read from process.env on the server side only. Nothing prefixed
// VITE_ is used for secrets, so nothing secret ever ships to the browser.
export default defineConfig({
  plugins: [react(), tailwindcss(), audoraApi()],
  // `@shared` must come first: Vite matches string aliases by prefix, and a bare '@' would
  // otherwise swallow '@shared/…'. The same two mappings are in tsconfig.app.json/node.json.
  resolve: {
    alias: {
      '@shared': path.resolve(import.meta.dirname, 'shared'),
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  server: { port: 5173, watch: { ignored: ['**/.audora/**', '**/evals/results/**', '**/dist/**'] } },
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/three') || id.includes('@react-three')) return 'three';
          if (id.includes('@sparkjsdev')) return 'spark';
        },
      },
    },
  },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
} as any);
