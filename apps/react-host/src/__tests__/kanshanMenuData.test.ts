import { describe, expect, it } from 'vitest';
import { resolveActionFromPetLike, sortKanshanProps } from '../kanshanMenuData';

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
});
