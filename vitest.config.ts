import { defineConfig } from 'vitest/config';

// Does not load Vite's application config or any .env / browser Firebase config.
export default defineConfig({ test: {
  environment: 'node', include: ['tests/unit/**/*.test.{ts,tsx}'],
  clearMocks: true, restoreMocks: true,
} });
