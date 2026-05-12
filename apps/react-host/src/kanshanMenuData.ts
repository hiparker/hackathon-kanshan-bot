import type { PetAction } from '@kanshan/bridge';

export interface KanshanPropItem {
  id: string;
  count: number;
  name: string;
  actionHint?: string;
  precondition?: string;
}

export interface KanshanTaskItem {
  id: string;
  taskName: string;
  availableCount: number;
  totalCount: number;
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
  rewardsGranted: Array<{ kind: string; itemId?: string; qty?: number }>;
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

const CONFIGURED_API_BASE_URL = import.meta.env.VITE_KANSHAN_API_BASE_URL || 'http://localhost:8787';
const API_PREFIX = import.meta.env.PROD ? `${CONFIGURED_API_BASE_URL.replace(/\/$/, '')}/api` : '/api';
const AUTH_STORAGE_KEY = 'kanshan.session';
const AUTH_MODE = import.meta.env.VITE_KANSHAN_AUTH_MODE || 'mock';
const DEV_AUTH_CODE = import.meta.env.VITE_KANSHAN_AUTH_CODE || 'local-dev';
const TASK_PERIODS = ['daily', 'weekly', 'story', 'challenge'] as const;

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
  loginUrl.searchParams.set('return_to', window.location.origin);

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('kanshan_open_external_url', { url: loginUrl.toString() });
  } catch {
    window.open(loginUrl.toString(), 'kanshan-zhihu-login', 'width=520,height=720,noopener=false,noreferrer=false');
  }
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
  })));
}

export async function fetchKanshanTasks(): Promise<KanshanTaskItem[]> {
  const results = await Promise.all(
    TASK_PERIODS.map((period) => apiFetch<TasksResponse>(`/tasks?period=${period}`)),
  );

  return results.flatMap((response) => response.tasks.map((task) => ({
    id: task.task_id,
    taskName: task.name,
    availableCount: task.done_count,
    totalCount: task.target_count,
  })));
}

export async function fetchKanshanDefaultState(): Promise<KanshanDefaultState> {
  const state = await apiFetch<PetStateResponse>('/pet/state/tick', { method: 'POST', body: '{}' });
  return { ...petSnapshotToDefaultState(petStateResponseToSnapshot(state)), actionHint: state.action_hint };
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

export async function progressKanshanTask(taskId: string, delta = 1): Promise<KanshanProgressTaskResult> {
  const response = await apiFetch<ProgressTaskResponse>('/tasks/progress', {
    method: 'POST',
    body: JSON.stringify({ task_id: taskId, delta }),
  });
  return {
    rewardsGranted: (response.rewards_granted ?? []).map((reward) => ({
      kind: reward.kind,
      itemId: reward.item_id,
      qty: reward.qty,
    })),
  };
}
