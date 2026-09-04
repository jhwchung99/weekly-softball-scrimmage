import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Business-logic tests run under the default `node` environment (no DOM
// needed). Component tests opt into jsdom per-file via a
// `// @vitest-environment jsdom` comment at the top of the file, rather
// than a second full project config — simpler for a codebase this size.
// See planner/2026-09-04-profile-edit-rate-limiting-testing-plan.md, Step 3.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    globals: false,
    setupFiles: ['./vitest.setup.ts'],
  },
});
