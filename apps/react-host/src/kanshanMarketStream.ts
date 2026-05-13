import type { PetAction } from '@kanshan/bridge';

export interface KanshanMarketWeather {
  city: string;
  condition: string;
  temp_c: number;
  feels_like_c: number;
  humidity: number;
}

export interface KanshanMarketQuote {
  key: string;
  label: string;
  price: number;
  unit?: string;
  change?: number;
  change_percent?: number;
}

export interface KanshanMarketNews {
  source: string;
  category: string;
  title: string;
  summary?: string;
  url?: string;
  published_at?: string;
}

export interface KanshanMarketSnapshot {
  generated_at: number;
  summary: string;
  weather?: KanshanMarketWeather;
  quotes: KanshanMarketQuote[];
  news?: KanshanMarketNews[];
  warnings?: string[];
}

export interface KanshanMarketDialogueCandidate {
  text: string;
  url?: string;
}

interface MarketSnapshotEnvelope {
  type: 'market_snapshot';
  interval_sec?: number;
  data: KanshanMarketSnapshot;
}

interface MarketErrorEnvelope {
  type: 'market_error';
  interval_sec?: number;
  error: string;
}

interface ConnectKanshanMarketStreamOptions {
  onSnapshot: (snapshot: KanshanMarketSnapshot) => void;
  onError?: (error: string) => void;
}

const DEFAULT_API_BASE_URL = import.meta.env.PROD ? 'https://kanshan.bedebug.com' : 'http://localhost:8787';
const CONFIGURED_API_BASE_URL = import.meta.env.VITE_KANSHAN_API_BASE_URL || DEFAULT_API_BASE_URL;
const MAX_RECONNECT_DELAY_MS = 15000;
const WEATHER_CITY_ZH_MAP: Record<string, string> = {
  beijing: '北京',
  shanghai: '上海',
  shenzhen: '深圳',
  guangzhou: '广州',
  hangzhou: '杭州',
  chengdu: '成都',
  hongkong: '香港',
  'hong kong': '香港',
  tianjin: '天津',
  chongqing: '重庆',
  wuhan: '武汉',
  nanjing: '南京',
  suzhou: '苏州',
  xian: '西安',
  "xi'an": '西安',
  xiamen: '厦门',
};

const WEATHER_CONDITION_ZH_RULES: Array<[RegExp, string]> = [
  [/thunder/i, '雷暴'],
  [/sleet/i, '雨夹雪'],
  [/snow/i, '雪'],
  [/drizzle/i, '毛毛雨'],
  [/shower/i, '阵雨'],
  [/rain/i, '雨'],
  [/overcast/i, '阴'],
  [/partly\s*cloud/i, '局部多云'],
  [/cloud/i, '多云'],
  [/\bclear\b/i, '晴'],
  [/sunny/i, '晴'],
  [/mist|fog|haze/i, '雾'],
  [/wind/i, '有风'],
];

export function connectKanshanMarketStream(options: ConnectKanshanMarketStreamOptions): () => void {
  let socket: WebSocket | null = null;
  let reconnectTimer: number | null = null;
  let reconnectAttempt = 0;
  let stopped = false;

  const clearReconnectTimer = () => {
    if (reconnectTimer === null) return;
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  };

  const scheduleReconnect = () => {
    if (stopped) return;
    clearReconnectTimer();
    const delay = Math.min(1000 * 2 ** reconnectAttempt, MAX_RECONNECT_DELAY_MS);
    reconnectAttempt += 1;
    reconnectTimer = window.setTimeout(connect, delay);
  };

  const connect = () => {
    if (stopped) return;

    try {
      socket = new WebSocket(resolveMarketWebSocketUrl());
    } catch (error) {
      options.onError?.(error instanceof Error ? error.message : String(error));
      scheduleReconnect();
      return;
    }

    socket.addEventListener('open', () => {
      reconnectAttempt = 0;
    });

    socket.addEventListener('message', (event) => {
      try {
        const payload = JSON.parse(String(event.data)) as MarketSnapshotEnvelope | MarketErrorEnvelope;
        if (payload.type === 'market_snapshot' && payload.data) {
          options.onSnapshot(payload.data);
          return;
        }
        if (payload.type === 'market_error') {
          options.onError?.(payload.error || 'market stream error');
        }
      } catch (error) {
        options.onError?.(error instanceof Error ? error.message : String(error));
      }
    });

    socket.addEventListener('error', () => {
      options.onError?.('market websocket disconnected');
    });

    socket.addEventListener('close', () => {
      socket = null;
      scheduleReconnect();
    });
  };

  connect();

  return () => {
    stopped = true;
    clearReconnectTimer();
    socket?.close();
    socket = null;
  };
}

export function formatKanshanMarketDialogue(
  snapshot: KanshanMarketSnapshot,
  randomValue: number = Math.random(),
): string {
  const candidate = pickKanshanMarketDialogueCandidate(snapshot, randomValue);
  if (!candidate && snapshot.summary.trim()) {
    return `看山播报：${snapshot.summary.trim()}`;
  }
  if (!candidate) {
    return '';
  }
  return `看山播报：${candidate.text}`;
}

export function chooseKanshanMarketReactionAction(snapshot: KanshanMarketSnapshot): PetAction {
  const quoteSwing = snapshot.quotes.some((item) => Math.abs(item.change_percent ?? 0) >= 2);
  if (quoteSwing) return 'run';
  return 'happy';
}

export function pickKanshanMarketDialogueCandidate(
  snapshot: KanshanMarketSnapshot,
  randomValue: number = Math.random(),
): KanshanMarketDialogueCandidate | null {
  const candidates = buildKanshanMarketDialogueCandidates(snapshot);
  if (candidates.length === 0) return null;
  const index = Math.max(0, Math.min(candidates.length - 1, Math.floor(randomValue * candidates.length)));
  return candidates[index] ?? null;
}

export function buildKanshanMarketDialogueCandidates(snapshot: KanshanMarketSnapshot): KanshanMarketDialogueCandidate[] {
  const candidates: KanshanMarketDialogueCandidate[] = [];

  if (snapshot.weather) {
    const weather = snapshot.weather;
    const city = localizeWeatherCity(weather.city);
    const condition = localizeWeatherCondition(weather.condition);
    candidates.push({ text: `天气 ${city} ${condition} ${weather.temp_c}C` });
  }

  const gold = findQuote(snapshot.quotes, 'gold');
  const btc = findQuote(snapshot.quotes, 'btc');
  const eth = findQuote(snapshot.quotes, 'eth');
  const shanghai = findQuote(snapshot.quotes, 'shanghai');
  const shenzhen = findQuote(snapshot.quotes, 'shenzhen');
  const nasdaq = findQuote(snapshot.quotes, 'nasdaq');
  const hangSeng = findQuote(snapshot.quotes, 'hang_seng');

  if (gold) candidates.push({ text: `黄金 ${formatPrice(gold.price)}` });
  if (btc) candidates.push({ text: `BTC ${formatPrice(btc.price)}` });
  if (eth) candidates.push({ text: `ETH ${formatPrice(eth.price)}` });
  if (shanghai) candidates.push({ text: `上证 ${formatPrice(shanghai.price)}` });
  if (shenzhen) candidates.push({ text: `深证 ${formatPrice(shenzhen.price)}` });
  if (nasdaq) candidates.push({ text: `NASDAQ ${formatPrice(nasdaq.price)}` });
  if (hangSeng) candidates.push({ text: `恒生 ${formatPrice(hangSeng.price)}` });

  for (const item of snapshot.news ?? []) {
    const title = item.title.trim();
    if (!title) continue;
    candidates.push({
      text: `新闻：${title}`,
      url: item.url?.trim() || undefined,
    });
  }

  return candidates;
}

function resolveMarketWebSocketUrl(): string {
  const base = CONFIGURED_API_BASE_URL.trim();
  if (base) {
    return `${normalizeWebSocketBase(base)}/ws/market`;
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws/market`;
}

function normalizeWebSocketBase(base: string): string {
  const trimmed = base.replace(/\/$/, '');
  if (trimmed.startsWith('ws://') || trimmed.startsWith('wss://')) return trimmed;
  if (trimmed.startsWith('http://')) return `ws://${trimmed.slice('http://'.length)}`;
  if (trimmed.startsWith('https://')) return `wss://${trimmed.slice('https://'.length)}`;
  return trimmed;
}

function findQuote(quotes: KanshanMarketQuote[], key: string): KanshanMarketQuote | undefined {
  return quotes.find((item) => item.key === key);
}

function formatPrice(value: number): string {
  if (!Number.isFinite(value)) return '-';
  if (Math.abs(value) >= 1000) {
    return value.toFixed(2);
  }
  return value.toFixed(2);
}

function localizeWeatherCity(city: string): string {
  const trimmed = city.trim();
  if (!trimmed) return '';
  if (/[\u4e00-\u9fff]/.test(trimmed)) return trimmed;
  return WEATHER_CITY_ZH_MAP[trimmed.toLowerCase()] ?? trimmed;
}

function localizeWeatherCondition(condition: string): string {
  const trimmed = condition.trim();
  if (!trimmed) return '';
  if (/[\u4e00-\u9fff]/.test(trimmed)) return trimmed;
  for (const [pattern, replacement] of WEATHER_CONDITION_ZH_RULES) {
    if (pattern.test(trimmed)) {
      return replacement;
    }
  }
  return trimmed;
}
