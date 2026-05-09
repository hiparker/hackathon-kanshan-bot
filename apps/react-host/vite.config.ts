import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const bridgeSource = new URL('../../packages/kanshan-bridge/src/index.ts', import.meta.url).pathname;
const threeRuntimeSource = new URL('../../packages/kanshan-three-runtime/src/index.ts', import.meta.url).pathname;

export default defineConfig(({ mode }) => {
  const envDir = new URL('.', import.meta.url).pathname;
  const env = loadEnv(mode, envDir, '');
  const kanshanApiBaseUrl = env.VITE_KANSHAN_API_BASE_URL || 'http://localhost:8787';

  return {
    plugins: [react()],
    assetsInclude: ['**/*.glb'],
    resolve: {
      dedupe: ['react', 'react-dom'],
      alias: {
        '@kanshan/bridge': bridgeSource,
        '@kanshan/three-runtime': threeRuntimeSource,
      },
    },
    server: {
      proxy: {
        '/proxy-openai': {
          target: env.VITE_OPENAI_BASE_URL,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/proxy-openai/, ''),
        },
        '/api': {
          target: kanshanApiBaseUrl,
          changeOrigin: true,
        },
      },
    },
  };
});
