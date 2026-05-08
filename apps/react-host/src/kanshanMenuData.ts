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
  action: 'idle';
}

const mockPropItems: KanshanPropItem[] = [
  { id: 'dried-fish', count: 12, name: '小鱼干' },
  { id: 'nutrition-can', count: 5, name: '营养罐头' },
  { id: 'cold-medicine', count: 3, name: '感冒药' },
  { id: 'revive-feather', count: 1, name: '复活羽毛' },
  { id: 'energy-drink', count: 8, name: '能量饮料' },
];

const mockDefaultState: KanshanDefaultState = { action: 'idle' };

const mockTaskItems: KanshanTaskItem[] = [
  { id: 'daily-pat', taskName: '每日摸摸', availableCount: 1, totalCount: 3 },
  { id: 'feed-once', taskName: '投喂一次', availableCount: 2, totalCount: 5 },
  { id: 'finish-interaction', taskName: '完成互动', availableCount: 0, totalCount: 1 },
];

function waitForMockApi() {
  return new Promise((resolve) => window.setTimeout(resolve, 180));
}

export async function fetchMockProps(): Promise<KanshanPropItem[]> {
  await waitForMockApi();
  return mockPropItems.map((item) => ({ ...item }));
}

export async function fetchMockTasks(): Promise<KanshanTaskItem[]> {
  await waitForMockApi();
  return mockTaskItems.map((item) => ({ ...item }));
}

export async function fetchMockDefaultState(): Promise<KanshanDefaultState> {
  await waitForMockApi();
  return { ...mockDefaultState };
}
