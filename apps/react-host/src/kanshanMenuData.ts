import type { PetAction } from '@kanshan/bridge';

export interface KanshanPropItem {
  id: string;
  count: number;
  name: string;
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
}

/** 与后端 POST /inventory/use 返回的 new_state 对齐（camelCase 已在客户端映射） */
export interface KanshanPetSnapshot {
  hunger: number;
  happiness: number;
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
}

export interface KanshanProgressTaskResult {
  rewardsGranted: Array<{ kind: string; itemId?: string; qty?: number }>;
}

interface AuthResponse {
  session_token: string;
  expires_at: number;
}

interface InventoryResponse {
  items: Array<{
    item_id: string;
    name: string;
    qty: number;
  }>;
}

interface PetStateResponse {
  lifecycle: string;
  mood: string;
  hunger: number;
  happiness: number;
  energy: number;
  health: number;
  growth: number;
  last_tick_at: number;
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

const API_PREFIX = '/api';
const AUTH_STORAGE_KEY = 'kanshan.session';
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

async function signIn(): Promise<AuthResponse> {
  const response = await fetch(`${API_PREFIX}/auth/zhihu`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: DEV_AUTH_CODE }),
  });

  if (!response.ok) {
    throw await toApiError(response);
  }

  const session = await response.json() as AuthResponse;
  writeStoredSession(session);
  return session;
}

async function getSessionToken(): Promise<string> {
  const storedSession = readStoredSession();
  if (storedSession) return storedSession.session_token;
  return (await signIn()).session_token;
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  headers.set('X-Session-Token', await getSessionToken());

  const response = await fetch(`${API_PREFIX}${path}`, { ...init, headers });
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

/** 与后端 pet 快照字段对齐，用于清单道具使用后直接驱动 3D 默认姿态 */
export function resolveActionFromPetLike(state: {
  lifecycle: string;
  hunger: number;
  energy: number;
  health: number;
}): PetAction {
  if (state.lifecycle === 'dead') return 'dead';
  if (state.lifecycle === 'sick') return 'sick';
  if (state.lifecycle === 'hungry' || state.hunger <= 20) return 'hungry';
  if (state.energy <= 20) return 'sleepy';
  if (state.health <= 20) return 'sick';
  return 'idle';
}

export function petSnapshotToDefaultState(snapshot: KanshanPetSnapshot): KanshanDefaultState {
  return {
    action: resolveActionFromPetLike(snapshot),
    lifecycle: snapshot.lifecycle,
    mood: snapshot.mood,
  };
}

export async function fetchKanshanProps(): Promise<KanshanPropItem[]> {
  const response = await apiFetch<InventoryResponse>('/inventory');
  return response.items.map((item) => ({
    id: item.item_id,
    name: item.name,
    count: item.qty,
  }));
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
  return petSnapshotToDefaultState({
    hunger: state.hunger,
    happiness: state.happiness,
    energy: state.energy,
    health: state.health,
    growth: state.growth,
    mood: state.mood,
    lifecycle: state.lifecycle,
    lastTickAt: state.last_tick_at,
  });
}

export async function useKanshanProp(itemId: string): Promise<KanshanUsePropResult> {
  const response = await apiFetch<UsePropResponse>('/inventory/use', {
    method: 'POST',
    body: JSON.stringify({ item_id: itemId }),
  });
  const newState: KanshanPetSnapshot | undefined = response.new_state
    ? {
        hunger: response.new_state.hunger,
        happiness: response.new_state.happiness,
        energy: response.new_state.energy,
        health: response.new_state.health,
        growth: response.new_state.growth,
        mood: response.new_state.mood,
        lifecycle: response.new_state.lifecycle,
        lastTickAt: response.new_state.last_tick_at,
      }
    : undefined;
  return { actionHint: response.action_hint, newState };
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
