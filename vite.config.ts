import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base is set for project-pages hosting (https://<user>.github.io/hpc-topology-viewer/).
// Override with VITE_BASE=/ for root hosting or local preview.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/hpc-topology-viewer/',
  plugins: [react()],
  build: {
    rollupOptions: {
      input: new URL('./index.html', import.meta.url).pathname,
    },
  },
});
