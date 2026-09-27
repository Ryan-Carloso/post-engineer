import { defineConfig } from 'cypress';
import registerCodeCoverageTasks from '@cypress/code-coverage/task';
import { loadEnvConfig } from '@next/env';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

loadEnvConfig(process.cwd());

interface SaveDownloadedVideoTask {
  filename: string;
  base64: string;
  contentType: string;
}

interface SavedVideoInfo {
  path: string;
  bytes: number;
  isMp4: boolean;
}

const MIN_VIDEO_BYTES = 100_000;

export default defineConfig({
  e2e: {
    baseUrl: 'http://localhost:3434',
    supportFile: 'cypress/support/e2e.ts',
    specPattern: 'cypress/e2e/**/*.cy.ts',
    video: false,
    screenshotOnRunFailure: true,
    env: {
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
      supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      e2eTestEmail: process.env.E2E_TEST_EMAIL,
      e2eTestPassword: process.env.E2E_TEST_PASSWORD,
      codeCoverage: {
        url: '/api/coverage',
        include: [
          'app/**/page.tsx',
          'app/**/layout.tsx',
          'app/providers.tsx',
          'components/**/*.tsx',
          'lib/api.ts',
          'lib/hooks.ts',
          'lib/i18n/**/*.{ts,tsx}',
          'lib/store.ts',
          'lib/ui.tsx',
        ],
      },
    },
    setupNodeEvents(on, config) {
      registerCodeCoverageTasks(on, config);
      on('task', {
        //---------------
        // saveDownloadedVideo — persists the MP4 downloaded through the
        // app's authenticated route and validates: video content-type,
        // minimum size, and MP4 signature ('ftyp' box at offset 4).
        //---------------
        async saveDownloadedVideo({ filename, base64, contentType }: SaveDownloadedVideoTask): Promise<SavedVideoInfo> {
          if (!/^video\//i.test(contentType)) {
            throw new Error(`Unexpected video content type: ${contentType}`);
          }
          const buffer = Buffer.from(base64, 'base64');
          if (buffer.length < MIN_VIDEO_BYTES) {
            throw new Error(`Downloaded video is too small: ${buffer.length} bytes`);
          }
          const isMp4 = buffer.subarray(4, 8).toString('latin1') === 'ftyp';
          if (!isMp4) {
            throw new Error('Downloaded file is missing the MP4 ftyp signature');
          }
          const safeName = path.basename(filename);
          const outputPath = path.resolve(config.projectRoot, 'cypress/downloads', safeName);
          await writeFile(outputPath, buffer);
          return { path: outputPath, bytes: buffer.length, isMp4 };
        },
      });
      return config;
    },
  },
});
