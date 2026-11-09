import { defineConfig } from 'playwright/test';

const port = process.env.PLAYWRIGHT_PRODUCTION_PORT ?? '5174';
const baseURL = `http://127.0.0.1:${port}`;

// This suite targets the built worker and deployed runtime assets, not Vite's dev server.
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: 'production-onnx.spec.ts',
  timeout: 60_000,
  use: { baseURL },
  webServer: {
    command: `npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
