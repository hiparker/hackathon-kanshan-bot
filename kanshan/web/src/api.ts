// 统一的 API 工具（走 /api 前缀 → vite 代理到 :8787）
export const API_BASE = '/api';

export async function api<T = any>(
  path: string,
  opts: { method?: string; body?: any; headers?: Record<string, string> } = {},
): Promise<T> {
  const { method = 'GET', body, headers = {} } = opts;
  const init: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  const r = await fetch(API_BASE + path, init);
  const text = await r.text();
  let data: any;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!r.ok) {
    const msg = data?.detail?.message || data?.detail || data?.error || r.statusText;
    const e: any = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    e.status = r.status;
    e.data = data;
    throw e;
  }
  return data as T;
}

export function eventSource(userId: string): EventSource {
  return new EventSource(`${API_BASE}/events?userId=${encodeURIComponent(userId)}`);
}
