import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchKanshanPetSnapshot, petSnapshotToStats, resolveActionFromPetLike, sortKanshanProps, storeKanshanSession } from '../kanshanMenuData';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('kanshan menu data', () => {
  it('maps hunger and spirit thresholds to default actions', () => {
    expect(resolveActionFromPetLike({ lifecycle: 'normal', hunger: 59, spirit: 100, health: 100 })).toBe('hungry');
    expect(resolveActionFromPetLike({ lifecycle: 'normal', hunger: 100, spirit: 20, health: 100 })).toBe('sleepy');
    expect(resolveActionFromPetLike({ lifecycle: 'sick', hunger: 100, spirit: 100, health: 100 })).toBe('sick');
    expect(resolveActionFromPetLike({ lifecycle: 'dead', hunger: 100, spirit: 100, health: 100 })).toBe('dead');
  });

  it('keeps medicine and revive feather at the bottom of props', () => {
    const sorted = sortKanshanProps([
      { id: 'revive-feather', name: '复活羽毛', count: 1 },
      { id: 'fish-jerky', name: '小鱼干', count: 5 },
      { id: 'cold-medicine', name: '感冒药', count: 1 },
      { id: 'nutrition-can', name: '营养罐头', count: 1 },
    ]);

    expect(sorted.map((item) => item.id)).toEqual([
      'fish-jerky',
      'nutrition-can',
      'cold-medicine',
      'revive-feather',
    ]);
  });

  it('fetches current pet stats without ticking state', async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
    });
    storeKanshanSession({
      user_id: 'u1',
      zhihu_user_id: 'z1',
      name: 'tester',
      session_token: 's1',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      hunger: 88,
      happiness: 66,
      spirit: 44,
      energy: 44,
      health: 100,
      growth: 0,
      mood: 'normal',
      lifecycle: 'normal',
      last_tick_at: 1,
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const snapshot = await fetchKanshanPetSnapshot();

    expect(fetchMock).toHaveBeenCalledWith('/api/pet/state', expect.objectContaining({ headers: expect.any(Headers) }));
    expect(petSnapshotToStats(snapshot)).toEqual({ hunger: 88, happiness: 66, spirit: 44 });
  });
});
