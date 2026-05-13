const raw = import.meta.env.VITE_KANSHAN_MODEL_WEB_URL;

/** Web 构建：GLB HTTPS 入口由 `VITE_KANSHAN_MODEL_WEB_URL` 提供；桌面构建改用 `kanshanModelConfig.desktop.ts`，勿在此处写死的公网 CDN。 */
export const kanshanModelConfig = {
  id: 'kanshan-model-v5-web',
  fileName: 'kanshan-model-v5-web.glb',
  url: typeof raw === 'string' && raw.length > 0 ? raw : '',
} as const;
