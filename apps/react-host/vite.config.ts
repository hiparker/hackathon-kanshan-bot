import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const bridgeSource = new URL('../../packages/kanshan-bridge/src/index.ts', import.meta.url).pathname;
const threeRuntimeSource = new URL('../../packages/kanshan-three-runtime/src/index.ts', import.meta.url).pathname;
const desktopModelConfigSource = new URL('./src/kanshanModelConfig.desktop.ts', import.meta.url).pathname;
const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';

export default defineConfig(({ mode }) => {
  const envDir = new URL('.', import.meta.url).pathname;
  const env = loadEnv(mode, envDir, '');
  const isDesktopMode = mode === 'desktop' || env.VITE_KANSHAN_DESKTOP === 'true';
  const kanshanApiBaseUrl = env.VITE_KANSHAN_API_BASE_URL || 'http://localhost:8787';
  const useSecondMe = env.VITE_SECONDME_CHAT === '1' || env.VITE_SECONDME_CHAT === 'true';
  const openAiProxyTarget = useSecondMe
    ? 'https://api.mindverse.com/gate/lab'
    : (env.VITE_OPENAI_BASE_URL || DEFAULT_OPENAI_BASE_URL);

  return {
    plugins: [react()],
    assetsInclude: ['**/*.glb'],
    resolve: {
      dedupe: ['react', 'react-dom'],
      alias: {
        '@kanshan/bridge': bridgeSource,
        '@kanshan/three-runtime': threeRuntimeSource,
        ...(isDesktopMode ? { './kanshanModelConfig': desktopModelConfigSource } : {}),
      },
    },
    server: {
      proxy: {
        '/proxy-openai': {
          target: openAiProxyTarget,
          changeOrigin: true,
          rewrite: (path) => {
            if (useSecondMe) {
              return '/api/secondme/chat/stream';
            }
            return path.replace(/^\/proxy-openai/, '');
          },
        },
        '/api': {
          target: kanshanApiBaseUrl,
          changeOrigin: true,
        },
      },
    },
  };
});
