import { defineConfig } from 'vitest/config';
import path from 'node:path';

/** `npm run eval` — evaluation runs (they call the running dev server at :5173 for live models). */
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: {
    environment: 'node',
    include: ['evals/**/*.eval.ts'],
    testTimeout: 15 * 60 * 1000,
    hookTimeout: 60_000,
    reporters: ['verbose'],
  },
});
