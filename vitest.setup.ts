import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// @testing-library/react's automatic cleanup-between-tests relies on a
// *global* afterEach, which doesn't exist with `globals: false` in
// vitest.config.ts — without this, one test's rendered DOM leaks into
// the next test in the same file (surfaced as "multiple elements
// found" errors that have nothing to do with the component itself).
afterEach(() => {
  cleanup();
});
