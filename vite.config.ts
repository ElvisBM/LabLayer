import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import { deploymentManifest, loadDeploymentEnvironment } from './server/deployment-environment';

export default defineConfig(({mode}) => {
  const env = { ...loadEnv(mode, '.', ''), ...process.env };
  const deployment = loadDeploymentEnvironment(env);
  return {
    plugins: [react(), tailwindcss(), {
      name: 'lablayer-environment-manifest',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'lablayer-environment.json', source: JSON.stringify(deploymentManifest(deployment), null, 2) });
      },
    }],
    define: {
      '__LABLAYER_FIREBASE_CONFIG__': JSON.stringify(deployment.config),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('/node_modules/@firebase/') || id.includes('/node_modules/firebase/')) {
              return 'firebase';
            }
          },
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: './src/setupTests.ts',
    },
  };
});
