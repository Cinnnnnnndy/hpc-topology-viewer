import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base is set for project-pages hosting (https://<user>.github.io/hpc-topology-viewer/).
// Override with VITE_BASE=/ for root hosting or local preview.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/hpc-topology-viewer/',
  plugins: [react()],
  // 每次构建生成唯一 id，用于给非哈希静态资源（如 iframe 里的 cube-cockpit.html）做缓存刷新，
  // 避免部署后浏览器/CDN 仍加载旧的 iframe 内容。
  define: { __BUILD_ID__: JSON.stringify(String(Date.now())) },
  build: {
    rollupOptions: {
      input: new URL('./index.html', import.meta.url).pathname,
    },
  },
});
