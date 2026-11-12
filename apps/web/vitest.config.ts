import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react-swc';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname),
      // server-only intentionally throws outside Next's server runtime.
      // Unit tests run in jsdom, so resolve the marker to Next's no-op shim.
      'server-only': path.resolve(__dirname, 'node_modules/next/dist/compiled/server-only/empty.js'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['**/__tests__/**/*.test.{ts,tsx}'],
    setupFiles: ['./test/setup.ts'],
    coverage: {
      // Separado do coverage/ usado pelo Cypress (@cypress/code-coverage)
      reportsDirectory: 'coverage-unit',
      reporter: ['text', 'html', 'json-summary'],
    },
  },
});
