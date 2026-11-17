import { defineConfig } from 'vitest/config';

export default defineConfig({ test: {
  environment: 'node', include: ['tests/integration/**/*.test.ts'],
  setupFiles: ['tests/emulator-guard.ts'], fileParallelism: false,
  testTimeout: 30000, hookTimeout: 30000,
} });
