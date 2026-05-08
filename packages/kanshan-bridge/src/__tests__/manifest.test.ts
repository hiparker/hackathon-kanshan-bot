import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { petActions, petMoods, petSlots } from '../index';

interface RuntimeManifest {
  actions: string[];
  moods: string[];
  slots: string[];
  props: Array<{ id: string; slot: string }>;
  effects: Array<{ id: string; slot: string }>;
}

const manifest = JSON.parse(
  readFileSync(resolve(__dirname, '../../../../assets/runtime/pet-manifest.json'), 'utf8'),
) as RuntimeManifest;

describe('runtime manifest', () => {
  it('matches bridge action, mood, and slot constants', () => {
    expect(manifest.actions).toEqual([...petActions]);
    expect(manifest.moods).toEqual([...petMoods]);
    expect(manifest.slots).toEqual([...petSlots]);
  });

  it('uses declared slots for props and effects', () => {
    const slots = new Set(manifest.slots);

    for (const prop of manifest.props) {
      expect(slots.has(prop.slot)).toBe(true);
    }

    for (const effect of manifest.effects) {
      expect(slots.has(effect.slot)).toBe(true);
    }
  });
});
