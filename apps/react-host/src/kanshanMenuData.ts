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

export interface KanshanUsePropResult {
  actionHint: string;
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
  energy: number;
  health: number;
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
  action_hint: string;
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
  if (state.lifecycle === 'dead') return 'dead';
  if (state.lifecycle === 'sick') return 'sick';
  if (state.lifecycle === 'hungry' || state.hunger <= 20) return 'hungry';
  if (state.energy <= 20) return 'sleepy';
  if (state.health <= 20) return 'sick';
  return 'idle';
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
  return {
    action: resolveActionFromPetState(state),
    lifecycle: state.lifecycle,
    mood: state.mood,
  };
}

export async function useKanshanProp(itemId: string): Promise<KanshanUsePropResult> {
  const response = await apiFetch<UsePropResponse>('/inventory/use', {
    method: 'POST',
    body: JSON.stringify({ item_id: itemId }),
  });
  return { actionHint: response.action_hint };
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
