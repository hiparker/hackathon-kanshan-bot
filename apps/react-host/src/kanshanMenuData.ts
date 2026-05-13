import type { PetAction } from '@kanshan/bridge';

export interface KanshanPropItem {
  id: string;
  count: number;
  name: string;
  actionHint?: string;
  precondition?: string;
  rewardHint?: string;
}

export interface KanshanRewardItem {
  kind: string;
  itemId?: string;
  qty?: number;
}

export interface KanshanTaskItem {
  id: string;
  taskName: string;
  availableCount: number;
  totalCount: number;
  action: 'open-url' | 'exercise' | 'disabled';
  url?: string;
  disabledHint?: string;
  rewards: KanshanRewardItem[];
  rewardHint?: string;
}

export interface KanshanDefaultState {
  action: PetAction;
  lifecycle: string;
  mood: string;
  hunger: number;
  happiness: number;
  spirit: number;
  energy: number;
  health: number;
  actionHint?: string;
}

/** 与后端 POST /inventory/use 返回的 new_state 对齐（camelCase 已在客户端映射） */
export interface KanshanPetSnapshot {
  hunger: number;
  happiness: number;
  spirit: number;
  energy: number;
  health: number;
  growth: number;
  mood: string;
  lifecycle: string;
  lastTickAt: number;
}

export interface KanshanPetStats {
  hunger: number;
  happiness: number;
  spirit: number;
}

export interface KanshanUsePropResult {
  actionHint: string;
  /** 道具生效后的看山状态；存在时不应再立刻调用 /pet/state/tick，以免二次衰减 */
  newState?: KanshanPetSnapshot;
  message?: string;
}

export interface KanshanInteractResult {
  ok: boolean;
  actionHint: string;
  newState?: KanshanPetSnapshot;
  message?: string;
}

export interface KanshanProgressTaskResult {
  rewardsGranted: KanshanRewardItem[];
  actionHint: string;
  newState?: KanshanPetSnapshot;
}

export interface KanshanDebugStateInput {
  hunger?: number;
  happiness?: number;
  spirit?: number;
  health?: number;
  lifecycle?: string;
  sickDaysAgo?: number;
}

interface AuthResponse {
  user_id: string;
  zhihu_user_id: string;
  name: string;
  session_token: string;
  expires_at: number;
}

export interface KanshanCurrentUser {
  userID: string;
  zhihuUserID: string;
  name: string;
}

export class KanshanAuthError extends Error {
  constructor(message = 'Kanshan authentication required') {
    super(message);
    this.name = 'KanshanAuthError';
  }
}

interface InventoryResponse {
  items: Array<{
    item_id: string;
    name: string;
    qty: number;
    action_hint?: string;
    precondition?: string;
  }>;
}

interface PetStateResponse {
  lifecycle: string;
  mood: string;
  hunger: number;
  happiness: number;
  spirit?: number;
  energy: number;
  health: number;
  growth: number;
  last_tick_at: number;
  action_hint?: string;
  message?: string;
}

interface TasksResponse {
  tasks: Array<{
    task_id: string;
    name: string;
    target_count: number;
    done_count: number;
    rewards?: Array<{ kind: string; item_id?: string; qty?: number }>;
  }>;
}

interface UsePropResponse {
  ok: boolean;
  action_hint: string;
  new_state: {
    hunger: number;
    happiness: number;
    spirit?: number;
    energy: number;
    health: number;
    growth: number;
    mood: string;
    lifecycle: string;
    last_tick_at: number;
  };
  message?: string;
}

interface InteractResponse {
  ok: boolean;
  action_hint?: string;
  message?: string;
  new_state: {
    hunger: number;
    happiness: number;
    spirit?: number;
    energy: number;
    health: number;
    growth: number;
    mood: string;
    lifecycle: string;
    last_tick_at: number;
  };
}

interface ProgressTaskResponse {
  rewards_granted?: Array<{ kind: string; item_id?: string; qty?: number }>;
  action_hint?: string;
  new_state?: {
    hunger: number;
    happiness: number;
    spirit?: number;
    energy: number;
    health: number;
    growth: number;
    mood: string;
    lifecycle: string;
    last_tick_at: number;
  };
}

interface RestockResponse {
  ok: boolean;
  item: {
    item_id: string;
    name: string;
    qty: number;
    action_hint?: string;
    precondition?: string;
  };
}

const DEFAULT_API_BASE_URL = import.meta.env.PROD ? 'https://kanshan.bedebug.com' : 'http://localhost:8787';
const CONFIGURED_API_BASE_URL = import.meta.env.VITE_KANSHAN_API_BASE_URL || DEFAULT_API_BASE_URL;
const API_PREFIX = import.meta.env.PROD ? `${CONFIGURED_API_BASE_URL.replace(/\/$/, '')}/api` : '/api';
const AUTH_STORAGE_KEY = 'kanshan.session';
const AUTH_MODE = import.meta.env.VITE_KANSHAN_AUTH_MODE || (import.meta.env.PROD ? 'oauth' : 'mock');
const DEV_AUTH_CODE = import.meta.env.VITE_KANSHAN_AUTH_CODE || 'local-dev';
const IS_DESKTOP_MODE = import.meta.env.MODE === 'desktop' || import.meta.env.VITE_KANSHAN_DESKTOP === 'true';
const DESKTOP_SESSION_TOKEN = import.meta.env.VITE_KANSHAN_DESKTOP_SESSION_TOKEN || 's_u_local-dev';
const TASK_ACTIONS: Record<string, Pick<KanshanTaskItem, 'action' | 'url' | 'disabledHint'>> = {
  'browse-5-posts': { action: 'open-url', url: 'https://www.zhihu.com' },
  'feed-2-times': { action: 'disabled', disabledHint: '请在道具菜单投喂' },
  'comment-3-times': { action: 'open-url', url: 'https://www.zhihu.com' },
  'exercise-2-times': { action: 'exercise' },
  'chat-1-time': { action: 'disabled', disabledHint: '请在对话界面完成' },
};

const PROP_REWARD_HINTS: Record<string, string> = {
  'fish-jerky': '使用后：饥饿 +25',
  'nutrition-can': '使用后：饥饿 +50，健康 +10',
  'yarn-ball': '使用后：快乐 +15，精力 +10',
  'cat-baton': '使用后：快乐 +30',
  'cold-medicine': '生病时使用：健康 +40',
  'revive-feather': '死亡时使用：恢复正常',
  'energy-drink': '使用后：精力 +40',
};

const ITEM_NAME_MAP: Record<string, string> = {
  'fish-jerky': '小鱼干',
  'nutrition-can': '营养罐头',
  'yarn-ball': '毛线球',
  'cat-baton': '指挥猫棒',
  'cold-medicine': '感冒药',
  'revive-feather': '复活羽毛',
  'energy-drink': '能量饮料',
};

const TASK_REWARD_HINTS: Record<string, string> = {
  'browse-5-posts': '完成后：随机道具',
  'comment-3-times': '完成后：随机道具',
  'chat-1-time': '完成后：小概率复活羽毛',
  'exercise-2-times': '完成后：快乐 +5，精力 +10',
};

function readStoredSession(): AuthResponse | null {
  try {
    const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as AuthResponse;
    if (!session.session_token || session.expires_at <= Math.floor(Date.now() / 1000)) return null;
    return session;
  } catch {
    return null;
  }
}

function writeStoredSession(session: AuthResponse) {
  window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
}

export function signOutKanshan() {
  window.localStorage.removeItem(AUTH_STORAGE_KEY);
}

export function getStoredKanshanUser(): KanshanCurrentUser | null {
  const session = readStoredSession();
  return session ? authResponseToUser(session) : null;
}

export function consumeKanshanAuthRedirect(): KanshanCurrentUser | null {
  const encodedSession = new URLSearchParams(window.location.search).get('kanshan_auth');
  return consumeEncodedKanshanSession(encodedSession);
}

export function consumeKanshanDesktopAuthURL(rawUrl: string): KanshanCurrentUser | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'kanshan:' || url.hostname !== 'auth') return null;
    return consumeEncodedKanshanSession(url.searchParams.get('session') || url.searchParams.get('kanshan_auth'));
  } catch {
    return null;
  }
}

function consumeEncodedKanshanSession(encodedSession: string | null): KanshanCurrentUser | null {
  if (!encodedSession) return null;

  try {
    const normalizedSession = encodedSession.replace(/-/g, '+').replace(/_/g, '/');
    const paddedSession = normalizedSession.padEnd(Math.ceil(normalizedSession.length / 4) * 4, '=');
    const json = decodeURIComponent(escape(window.atob(paddedSession)));
    const session = JSON.parse(json) as AuthResponse;
    const user = storeKanshanSession(session);
    const url = new URL(window.location.href);
    url.searchParams.delete('kanshan_auth');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    return user;
  } catch {
    signOutKanshan();
    return null;
  }
}

export function isKanshanOAuthMode(): boolean {
  return AUTH_MODE === 'oauth';
}

export async function startZhihuLogin() {
  if (AUTH_MODE !== 'oauth') {
    const response = await fetch(`${API_PREFIX}/auth/zhihu`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: DEV_AUTH_CODE }),
    });
    if (!response.ok) throw await toApiError(response);

    const session = await response.json() as AuthResponse;
    storeKanshanSession(session);
    window.dispatchEvent(new CustomEvent('kanshan:auth-session', { detail: session }));
    return;
  }

  const loginUrl = new URL(`${API_PREFIX}/auth/zhihu/login`, window.location.origin);
  loginUrl.searchParams.set('return_to', IS_DESKTOP_MODE ? 'kanshan://auth' : window.location.origin);

  if (IS_DESKTOP_MODE) {
    await openLoginInDefaultBrowser(loginUrl.toString());
    return;
  }

  window.open(loginUrl.toString(), 'kanshan-zhihu-login', 'width=520,height=720,noopener=false,noreferrer=false');
}

async function openLoginInDefaultBrowser(url: string) {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('kanshan_open_external_url', { url });
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

export function redirectToZhihuLogin(returnTo = window.location.href) {
  const loginUrl = new URL(`${API_PREFIX}/auth/zhihu/login`, window.location.origin);
  loginUrl.searchParams.set('return_to', returnTo);
  window.location.assign(loginUrl.toString());
}

export function storeKanshanSession(session: AuthResponse): KanshanCurrentUser {
  writeStoredSession(session);
  return authResponseToUser(session);
}

export async function fetchCurrentKanshanUser(): Promise<KanshanCurrentUser | null> {
  const session = readStoredSession();
  if (!session) return null;

  const response = await fetch(`${API_PREFIX}/auth/me`, {
    headers: { 'X-Session-Token': session.session_token },
  });

  if (response.status === 401) {
    signOutKanshan();
    return null;
  }
  if (!response.ok) {
    throw await toApiError(response);
  }

  const user = await response.json() as { user_id: string; zhihu_user_id: string; name: string };
  return {
    userID: user.user_id,
    zhihuUserID: user.zhihu_user_id,
    name: user.name,
  };
}

async function getSessionToken(): Promise<string> {
  const storedSession = readStoredSession();
  if (storedSession) return storedSession.session_token;
  if (IS_DESKTOP_MODE) return DESKTOP_SESSION_TOKEN;
  throw new KanshanAuthError();
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  headers.set('X-Session-Token', await getSessionToken());

  const response = await fetch(`${API_PREFIX}${path}`, { ...init, headers });
  if (response.status === 401) {
    signOutKanshan();
    throw new KanshanAuthError();
  }
  if (!response.ok) {
    throw await toApiError(response);
  }
  return await response.json() as T;
}

async function toApiError(response: Response): Promise<Error> {
  const body = await response.text();
  return new Error(`Kanshan API request failed with status ${response.status}: ${body}`);
}

function resolveActionFromPetState(state: PetStateResponse): PetAction {
  return resolveActionFromPetLike(state);
}

function authResponseToUser(session: AuthResponse): KanshanCurrentUser {
  return {
    userID: session.user_id,
    zhihuUserID: session.zhihu_user_id,
    name: session.name,
  };
}

/** 与后端 pet 快照字段对齐，用于清单道具使用后直接驱动 3D 默认姿态 */
export function resolveActionFromPetLike(state: {
  lifecycle: string;
  hunger: number;
  spirit?: number;
  energy?: number;
  health: number;
}): PetAction {
  if (state.lifecycle === 'dead') return 'dead';
  if (state.lifecycle === 'sick') return 'sick';
  if (state.lifecycle === 'hungry' || state.hunger < 60) return 'hungry';
  if ((state.spirit ?? state.energy ?? 0) <= 20) return 'sleepy';
  if (state.health <= 20) return 'sick';
  return 'idle';
}

export function petSnapshotToDefaultState(snapshot: KanshanPetSnapshot): KanshanDefaultState {
  return {
    action: resolveActionFromPetLike(snapshot),
    lifecycle: snapshot.lifecycle,
    mood: snapshot.mood,
    hunger: snapshot.hunger,
    happiness: snapshot.happiness,
    spirit: snapshot.spirit,
    energy: snapshot.energy,
    health: snapshot.health,
  };
}

function petStateResponseToSnapshot(state: PetStateResponse | UsePropResponse['new_state'] | InteractResponse['new_state']): KanshanPetSnapshot {
  return {
    hunger: state.hunger,
    happiness: state.happiness,
    spirit: state.spirit ?? state.energy,
    energy: state.energy,
    health: state.health,
    growth: state.growth,
    mood: state.mood,
    lifecycle: state.lifecycle,
    lastTickAt: state.last_tick_at,
  };
}

function mapReward(reward: { kind: string; item_id?: string; qty?: number }): KanshanRewardItem {
  return {
    kind: reward.kind,
    itemId: reward.item_id,
    qty: reward.qty,
  };
}

function formatRewardHint(rewards: KanshanRewardItem[]): string | undefined {
  if (rewards.length === 0) return undefined;
  const rewardLabels = rewards.map((reward) => {
    const qty = reward.qty && reward.qty > 1 ? ` x${reward.qty}` : '';
    if (reward.kind === 'item' && reward.itemId) return `${ITEM_NAME_MAP[reward.itemId] ?? reward.itemId}${qty}`;
    if (reward.kind === 'growth') return `成长 +${reward.qty ?? 0}`;
    return reward.kind;
  });
  return `完成后：${rewardLabels.join('、')}`;
}

export function sortKanshanProps(items: KanshanPropItem[]): KanshanPropItem[] {
  const bottomOrder: Record<string, number> = {
    'cold-medicine': 98,
    'revive-feather': 99,
  };
  return [...items].sort((a, b) => (bottomOrder[a.id] ?? 0) - (bottomOrder[b.id] ?? 0));
}

export async function fetchKanshanProps(): Promise<KanshanPropItem[]> {
  const response = await apiFetch<InventoryResponse>('/inventory');
  return sortKanshanProps(response.items.map((item) => ({
    id: item.item_id,
    name: item.name,
    count: item.qty,
    actionHint: item.action_hint,
    precondition: item.precondition,
    rewardHint: PROP_REWARD_HINTS[item.item_id],
  })));
}

export async function fetchKanshanTasks(): Promise<KanshanTaskItem[]> {
  const response = await apiFetch<TasksResponse>('/tasks?period=daily');

  return response.tasks.map((task) => {
    const rewards = (task.rewards ?? []).map(mapReward);
    return {
      id: task.task_id,
      taskName: task.name,
      availableCount: task.done_count,
      totalCount: task.target_count,
      rewards,
      rewardHint: formatRewardHint(rewards) ?? TASK_REWARD_HINTS[task.task_id],
      ...(TASK_ACTIONS[task.task_id] ?? { action: 'disabled', disabledHint: '请在其他入口完成' }),
    };
  });
}

export async function fetchKanshanDefaultState(): Promise<KanshanDefaultState> {
  const state = await apiFetch<PetStateResponse>('/pet/state/tick', { method: 'POST', body: '{}' });
  return { ...petSnapshotToDefaultState(petStateResponseToSnapshot(state)), actionHint: state.action_hint };
}

export async function fetchKanshanPetSnapshot(): Promise<KanshanPetSnapshot> {
  const state = await apiFetch<PetStateResponse>('/pet/state');
  return petStateResponseToSnapshot(state);
}

export function petSnapshotToStats(snapshot: KanshanPetSnapshot): KanshanPetStats {
  return {
    hunger: snapshot.hunger,
    happiness: snapshot.happiness,
    spirit: snapshot.spirit,
  };
}

export async function useKanshanProp(itemId: string): Promise<KanshanUsePropResult> {
  const response = await apiFetch<UsePropResponse>('/inventory/use', {
    method: 'POST',
    body: JSON.stringify({ item_id: itemId }),
  });
  const newState: KanshanPetSnapshot | undefined = response.new_state
    ? petStateResponseToSnapshot(response.new_state)
    : undefined;
  return { actionHint: response.action_hint, newState, message: response.message };
}

export async function interactKanshan(action: 'chat' | 'pat' | 'exercise'): Promise<KanshanInteractResult> {
  const headers = new Headers();
  headers.set('Content-Type', 'application/json');
  headers.set('X-Session-Token', await getSessionToken());
  const response = await fetch(`${API_PREFIX}/pet/interact`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action }),
  });
  if (response.status === 401) {
    signOutKanshan();
    throw new KanshanAuthError();
  }
  const body = await response.json() as InteractResponse;
  if (!response.ok && response.status !== 409) {
    throw new Error(`Kanshan API request failed with status ${response.status}: ${JSON.stringify(body)}`);
  }
  return {
    ok: body.ok,
    actionHint: body.action_hint ?? '',
    message: body.message,
    newState: body.new_state ? petStateResponseToSnapshot(body.new_state) : undefined,
  };
}

export async function debugSetKanshanState(input: KanshanDebugStateInput): Promise<KanshanDefaultState> {
  const state = await apiFetch<PetStateResponse>('/pet/debug/state', {
    method: 'POST',
    body: JSON.stringify({
      hunger: input.hunger,
      happiness: input.happiness,
      spirit: input.spirit,
      health: input.health,
      lifecycle: input.lifecycle,
      sick_days_ago: input.sickDaysAgo,
    }),
  });
  return petSnapshotToDefaultState(petStateResponseToSnapshot(state));
}

export async function debugRestockKanshanProp(itemId: string, qty = 1): Promise<KanshanPropItem> {
  const response = await apiFetch<RestockResponse>('/inventory/restock', {
    method: 'POST',
    body: JSON.stringify({ item_id: itemId, qty, reason: 'debug_preview' }),
  });
  return {
    id: response.item.item_id,
    name: response.item.name,
    count: response.item.qty,
    actionHint: response.item.action_hint,
    precondition: response.item.precondition,
  };
}

export async function progressKanshanTask(taskId: string): Promise<KanshanProgressTaskResult> {
  const response = await apiFetch<ProgressTaskResponse>('/tasks/progress', {
    method: 'POST',
    body: JSON.stringify({ task_id: taskId }),
  });
  return {
    rewardsGranted: (response.rewards_granted ?? []).map(mapReward),
    actionHint: response.action_hint ?? '',
    newState: response.new_state ? petStateResponseToSnapshot(response.new_state) : undefined,
  };
}
