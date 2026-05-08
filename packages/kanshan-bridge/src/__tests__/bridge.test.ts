import { describe, expect, it, vi } from 'vitest';
import {
  createMemoryBridge,
  createPostMessageBridge,
  isPetCommand,
  normalizeYaw,
  validatePetCommand,
  type KanshanBridgeMessage,
  type PetRuntimeEvent,
} from '../index';

describe('normalizeYaw', () => {
  it('normalizes yaw into a positive 0 to 360 range', () => {
    expect(normalizeYaw(0)).toBe(0);
    expect(normalizeYaw(360)).toBe(0);
    expect(normalizeYaw(-1)).toBe(359);
    expect(normalizeYaw(721.5)).toBe(1.5);
  });
});

describe('validatePetCommand', () => {
  it('accepts valid commands', () => {
    expect(validatePetCommand({ type: 'playAction', action: 'happy', loop: true }).ok).toBe(true);
    expect(validatePetCommand({ type: 'showEffect', effectId: 'heart', slot: 'emotion', durationMs: 1200 }).ok).toBe(true);
    expect(isPetCommand({ type: 'equipProp', slot: 'head', propId: null })).toBe(true);
  });

  it('rejects invalid command structures', () => {
    expect(validatePetCommand({ type: 'jump' }).ok).toBe(false);
    expect(validatePetCommand({ type: 'setDirection', yaw: 'left' }).ok).toBe(false);
    expect(validatePetCommand({ type: 'playAction', action: 'jump' }).ok).toBe(false);
    expect(validatePetCommand({ type: 'equipProp', slot: 'pocket', propId: 123 }).ok).toBe(false);
    expect(validatePetCommand({ type: 'showEffect', slot: 'emotion' }).ok).toBe(false);
  });
});

describe('createMemoryBridge', () => {
  it('emits default events for commands', () => {
    const bridge = createMemoryBridge();
    const events: PetRuntimeEvent[] = [];
    bridge.onEvent((event) => events.push(event));

    bridge.send({ type: 'setDirection', yaw: -90 });
    bridge.send({ type: 'playAction', action: 'happy' });
    bridge.send({ type: 'equipProp', slot: 'head', propId: 'hat' });

    expect(events).toEqual([
      { type: 'directionChanged', yaw: 270 },
      { type: 'actionStart', action: 'happy' },
      { type: 'actionEnd', action: 'happy' },
      { type: 'propEquipped', slot: 'head', propId: 'hat' },
    ]);
  });

  it('supports unsubscribe and destroy', () => {
    const bridge = createMemoryBridge();
    const listener = vi.fn();
    const off = bridge.onEvent(listener);

    off();
    bridge.send({ type: 'setDirection', yaw: 10 });
    bridge.onEvent(listener);
    bridge.destroy();
    bridge.send({ type: 'setDirection', yaw: 20 });

    expect(listener).not.toHaveBeenCalled();
  });
});

describe('createPostMessageBridge', () => {
  it('posts command messages to target window', () => {
    const sourceWindow = new EventTarget() as Window;
    const targetWindow = { postMessage: vi.fn() };
    const bridge = createPostMessageBridge(targetWindow, { sourceWindow, targetOrigin: 'https://runtime.example' });

    bridge.send({ type: 'setDirection', yaw: 45 });

    expect(targetWindow.postMessage).toHaveBeenCalledWith(
      { scope: 'kanshan-runtime', kind: 'command', payload: { type: 'setDirection', yaw: 45 } },
      'https://runtime.example',
    );
    bridge.destroy();
  });

  it('receives allowed runtime events and ignores blocked origins', () => {
    const sourceWindow = new EventTarget() as Window;
    const targetWindow = { postMessage: vi.fn() };
    const bridge = createPostMessageBridge(targetWindow, {
      sourceWindow,
      targetOrigin: 'https://runtime.example',
      allowedOrigins: ['https://runtime.example'],
    });
    const listener = vi.fn();
    bridge.onEvent(listener);

    const message: KanshanBridgeMessage = {
      scope: 'kanshan-runtime',
      kind: 'event',
      payload: { type: 'ready' },
    };

    sourceWindow.dispatchEvent(new MessageEvent('message', { origin: 'https://blocked.example', data: message }));
    sourceWindow.dispatchEvent(new MessageEvent('message', { origin: 'https://runtime.example', data: message }));
    bridge.destroy();
    sourceWindow.dispatchEvent(new MessageEvent('message', { origin: 'https://runtime.example', data: message }));

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ type: 'ready' });
  });
});
