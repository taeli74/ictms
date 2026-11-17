import { defineConfig } from 'vite';

// public/app.js 는 번들되지 않는 일반 스크립트라 배포마다 캐시를 끊기 위해 빌드 시각을 붙입니다.
export default defineConfig({
  define: { __BUILD__: JSON.stringify(Date.now().toString(36)) },
  server: { port: 5173 },
});
