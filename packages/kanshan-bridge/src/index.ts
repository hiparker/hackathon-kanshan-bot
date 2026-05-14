export const petActions = [
  'idle',
  'walk',
  'run',
  'blink',
  'happy',
  'dragging',
  'hungry',
  'sleepy',
  'sick',
  'dead',
  'revive',
  'death-notice',
] as const;

export const petMoods = ['normal', 'happy', 'hungry', 'sleepy', 'sick'] as const;

export const petSlots = [
  'head',
  'mouth',
  'hand-left',
  'hand-right',
  'tail',
  'feet',
  'emotion',
] as const;

export type PetAction = (typeof petActions)[number];

export type PetMood = (typeof petMoods)[number];

export type PetSlot = (typeof petSlots)[number];

export type PetCommand =
  | { type: 'setDirection'; yaw: number }
  | { type: 'playAction'; action: PetAction; loop?: boolean; repetitions?: number }
  | { type: 'playClip'; clipName: string; loop?: boolean; repetitions?: number }
  | { type: 'setMood'; mood: PetMood }
  | { type: 'equipProp'; slot: PetSlot; propId: string | null }
  | { type: 'setPosition'; x: number; y: number; z?: number }
  | { type: 'showEffect'; effectId: string; slot?: PetSlot; durationMs?: number };

export type PetRuntimeEvent =
  | { type: 'ready' }
  | { type: 'modelLoadProgress'; loaded: number; total: number }
  | { type: 'animationClipMapReady'; clipNames: string[]; missingClipNames: string[] }
  | { type: 'actionStart'; action: PetAction }
  | { type: 'animationClipStart'; action: PetAction; clipName: string; durationMs?: number; loop?: boolean }
  | { type: 'rawClipStart'; clipName: string; durationMs?: number; loop?: boolean }
  | { type: 'rawClipEnd'; clipName: string }
  | { type: 'actionEnd'; action: PetAction }
  | { type: 'directionChanged'; yaw: number }
  | { type: 'propEquipped'; slot: PetSlot; propId: string | null }
  | { type: 'error'; code: string; message: string };

export interface KanshanRuntimeBridge {
  send(command: PetCommand): void;
  onEvent(listener: (event: PetRuntimeEvent) => void): () => void;
  destroy(): void;
}

export type PetCommandValidationResult =
  | { ok: true; command: PetCommand }
  | { ok: false; errors: string[] };

export interface MemoryBridgeOptions {
  onCommand?: (command: PetCommand, emit: (event: PetRuntimeEvent) => void) => void;
}

export interface PostMessageBridgeOptions {
  targetOrigin?: string;
  allowedOrigins?: readonly string[];
  sourceWindow?: Window;
}

export type KanshanBridgeMessage =
  | { scope: 'kanshan-runtime'; kind: 'command'; payload: PetCommand }
  | { scope: 'kanshan-runtime'; kind: 'event'; payload: PetRuntimeEvent };

const actionSet = new Set<string>(petActions);
const moodSet = new Set<string>(petMoods);
const slotSet = new Set<string>(petSlots);
const commandTypes = new Set<string>([
  'setDirection',
  'playAction',
  'playClip',
  'setMood',
  'equipProp',
  'setPosition',
  'showEffect',
]);

export function normalizeYaw(yaw: number): number {
  return ((yaw % 360) + 360) % 360;
}

export function validatePetCommand(value: unknown): PetCommandValidationResult {
  const errors: string[] = [];

  if (!isRecord(value)) {
    return { ok: false, errors: ['Command must be an object.'] };
  }

  if (typeof value.type !== 'string') {
    return { ok: false, errors: ['Command type must be a string.'] };
  }

  if (!commandTypes.has(value.type)) {
    return { ok: false, errors: [`Unknown command type: ${value.type}.`] };
  }

  switch (value.type) {
    case 'setDirection':
      requireNumber(value.yaw, 'yaw', errors);
      break;
    case 'playAction':
      requireStringUnion(value.action, 'action', actionSet, errors);
      optionalBoolean(value.loop, 'loop', errors);
      optionalPositiveInteger(value.repetitions, 'repetitions', errors);
      break;
    case 'playClip':
      requireString(value.clipName, 'clipName', errors);
      optionalBoolean(value.loop, 'loop', errors);
      optionalPositiveInteger(value.repetitions, 'repetitions', errors);
      break;
    case 'setMood':
      requireStringUnion(value.mood, 'mood', moodSet, errors);
      break;
    case 'equipProp':
      requireStringUnion(value.slot, 'slot', slotSet, errors);
      if (value.propId !== null && typeof value.propId !== 'string') {
        errors.push('propId must be a string or null.');
      }
      break;
    case 'setPosition':
      requireNumber(value.x, 'x', errors);
      requireNumber(value.y, 'y', errors);
      optionalNumber(value.z, 'z', errors);
      break;
    case 'showEffect':
      requireString(value.effectId, 'effectId', errors);
      optionalStringUnion(value.slot, 'slot', slotSet, errors);
      optionalNumber(value.durationMs, 'durationMs', errors);
      break;
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, command: value as PetCommand };
}

export function isPetCommand(value: unknown): value is PetCommand {
  return validatePetCommand(value).ok;
}

export function createMemoryBridge(options: MemoryBridgeOptions = {}): KanshanRuntimeBridge {
  const listeners = new Set<(event: PetRuntimeEvent) => void>();
  let destroyed = false;

  const emit = (event: PetRuntimeEvent) => {
    if (destroyed) return;
    for (const listener of listeners) {
      listener(event);
    }
  };

  return {
    send(command) {
      if (destroyed) return;
      const result = validatePetCommand(command);
      if (!result.ok) {
        emit({ type: 'error', code: 'INVALID_COMMAND', message: result.errors.join(' ') });
        return;
      }

      if (options.onCommand) {
        options.onCommand(result.command, emit);
        return;
      }

      emitEventForCommand(result.command, emit);
    },
    onEvent(listener) {
      if (destroyed) return () => undefined;
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    destroy() {
      destroyed = true;
      listeners.clear();
    },
  };
}

export function createPostMessageBridge(
  targetWindow: Pick<Window, 'postMessage'>,
  options: PostMessageBridgeOptions = {},
): KanshanRuntimeBridge {
  const sourceWindow = options.sourceWindow ?? globalThis.window;
  if (!sourceWindow) {
    throw new Error('sourceWindow is required outside a browser environment.');
  }
  const targetOrigin = options.targetOrigin ?? '*';
  const allowedOrigins = options.allowedOrigins ?? (targetOrigin === '*' ? undefined : [targetOrigin]);
  const listeners = new Set<(event: PetRuntimeEvent) => void>();
  let destroyed = false;

  const handleMessage = (event: MessageEvent) => {
    if (destroyed) return;
    if (allowedOrigins && !allowedOrigins.includes(event.origin)) return;
    const message = event.data;
    if (!isBridgeMessage(message) || message.kind !== 'event') return;

    for (const listener of listeners) {
      listener(message.payload);
    }
  };

  sourceWindow.addEventListener('message', handleMessage);

  return {
    send(command) {
      if (destroyed) return;
      const result = validatePetCommand(command);
      if (!result.ok) {
        throw new Error(result.errors.join(' '));
      }
      targetWindow.postMessage(
        { scope: 'kanshan-runtime', kind: 'command', payload: result.command } satisfies KanshanBridgeMessage,
        targetOrigin,
      );
    },
    onEvent(listener) {
      if (destroyed) return () => undefined;
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    destroy() {
      destroyed = true;
      listeners.clear();
      sourceWindow.removeEventListener('message', handleMessage);
    },
  };
}

function emitEventForCommand(command: PetCommand, emit: (event: PetRuntimeEvent) => void): void {
  switch (command.type) {
    case 'setDirection':
      emit({ type: 'directionChanged', yaw: normalizeYaw(command.yaw) });
      break;
    case 'playAction':
      emit({ type: 'actionStart', action: command.action });
      if (!command.loop) emit({ type: 'actionEnd', action: command.action });
      break;
    case 'playClip':
      emit({ type: 'rawClipStart', clipName: command.clipName });
      if (!command.loop) emit({ type: 'rawClipEnd', clipName: command.clipName });
      break;
    case 'equipProp':
      emit({ type: 'propEquipped', slot: command.slot, propId: command.propId });
      break;
    case 'setMood':
    case 'setPosition':
    case 'showEffect':
      break;
  }
}

function isBridgeMessage(value: unknown): value is KanshanBridgeMessage {
  return (
    isRecord(value) &&
    value.scope === 'kanshan-runtime' &&
    (value.kind === 'command' || value.kind === 'event') &&
    isRecord(value.payload)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string, errors: string[]): void {
  if (typeof value !== 'string' || value.length === 0) {
    errors.push(`${field} must be a non-empty string.`);
  }
}

function requireNumber(value: unknown, field: string, errors: string[]): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errors.push(`${field} must be a finite number.`);
  }
}

function optionalNumber(value: unknown, field: string, errors: string[]): void {
  if (value !== undefined) requireNumber(value, field, errors);
}

function optionalPositiveInteger(value: unknown, field: string, errors: string[]): void {
  if (value === undefined) return;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    errors.push(field + ' must be a positive integer when provided.');
  }
}

function optionalBoolean(value: unknown, field: string, errors: string[]): void {
  if (value !== undefined && typeof value !== 'boolean') {
    errors.push(`${field} must be a boolean when provided.`);
  }
}

function requireStringUnion(value: unknown, field: string, allowed: Set<string>, errors: string[]): void {
  if (typeof value !== 'string' || !allowed.has(value)) {
    errors.push(`${field} must be one of: ${Array.from(allowed).join(', ')}.`);
  }
}

function optionalStringUnion(value: unknown, field: string, allowed: Set<string>, errors: string[]): void {
  if (value !== undefined) requireStringUnion(value, field, allowed, errors);
}
