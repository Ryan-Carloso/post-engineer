import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react-swc';
import path from 'path';

const ALL_TESTS = '**/__tests__/**/*.test.{ts,tsx}';
const NODE_TESTS = '**/__tests__/**/*.node.test.{ts,tsx}';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname),
      'server-only': path.resolve(__dirname, 'node_modules/next/dist/compiled/server-only/empty.js'),
    },
  },
  test: {
    globals: true,
    setupFiles: ['./test/setup.ts'],
    coverage: {
      reportsDirectory: 'coverage-unit',
      reporter: ['text', 'html', 'json-summary'],
    },
    projects: [
      {
        extends: true,
        test: { name: 'dom', environment: 'jsdom', include: [ALL_TESTS], exclude: [...configDefaults.exclude, NODE_TESTS] },
      },
      {
        extends: true,
        test: { name: 'node', environment: 'node', include: [NODE_TESTS] },
      },
    ],
  },
});
