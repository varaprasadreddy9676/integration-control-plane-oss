/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'url';

export default defineConfig({
  plugins: [react()],
  base: '/integration-gateway/',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5174,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/tests/setup.ts'],
    exclude: ['node_modules', 'dist'],
    // Vitest's 5000ms default is too tight for slower/contended machines
    // (observed: a Windows box needed 30s+ for the same 87 tests that pass in
    // under 10s on CI and on macOS). Raising the floor avoids false failures
    // on legitimately slow environments without hiding a real hang — a test
    // that's actually stuck still times out, just later.
    testTimeout: 20000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      exclude: ['node_modules/', 'dist/', 'src/tests/'],
    },
  },
});
