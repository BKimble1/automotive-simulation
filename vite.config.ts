/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5176 },
  preview: { host: '127.0.0.1', port: 4176 },
  assetsInclude: ['**/*.bin'],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1600,
  },
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['src/__debug__/**', 'node_modules/**'],
    environment: 'node',
    testTimeout: 60000,
  },
});
