import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react-markdown') || id.includes('remark-') || id.includes('unified') || id.includes('micromark') || id.includes('mdast') || id.includes('hast')) {
              return 'vendor-markdown';
            }
            if (id.includes('lucide-react')) {
              return 'vendor-icons';
            }
            if (id.includes('react-dom') || id.includes('\\react\\') || id.includes('/react/')) {
              return 'vendor-react';
            }
          }
          return undefined;
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:25880',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://127.0.0.1:25880',
        ws: true,
      },
    },
  },
});
