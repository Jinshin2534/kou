import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5320 },
  test: { environment: 'node', include: ['src/**/*.test.js'] },
});
