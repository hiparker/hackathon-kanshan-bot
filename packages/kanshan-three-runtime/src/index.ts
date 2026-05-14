import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  normalizeYaw,
  validatePetCommand,
  petSlots,
  type KanshanRuntimeBridge,
  type PetAction,
  type PetCommand,
  type PetRuntimeEvent,
  type PetSlot,
} from '@kanshan/bridge';

export interface KanshanThreeRuntimeOptions {
  canvas: HTMLCanvasElement;
  pixelRatio?: number;
  modelUrl?: string;
  materialMode?: KanshanMaterialMode;
  clipMap?: Partial<Record<PetAction, readonly KanshanClipPreference[]>>;
  random?: () => number;
}

export type KanshanClipPreference = string | { clipName: string; weight?: number };

type EffectId = 'heart' | 'sweat' | 'music-note' | 'zhihu-call' | 'sleepy-zzz' | 'sick-dizzy' | 'hungry-growl';
type SlotMap = Record<PetSlot, THREE.Group>;
type KanshanMaterialMode = 'pbr' | 'texture' | 'toon-bw';

const ink = 0x17202a;
const white = 0xffffff;
/** 知乎品牌蓝，运动「打 call」粒子 */
const zhihuBlue = 0x0084ff;
const boardBrown = 0x8a6a44;
const heartRed = 0xe94560;
const sweatBlue = 0x62b6dd;
/** 人死魂离：冷雾为主，一丝残余体温 */
const departOuterMist = 0xc8dae8;
const departSoulBody = 0xe4edf8;
const departWarmFaint = 0xfff3eb;
const departCoreChill = 0xd2dff2;
const departTetherLine = 0x9eb4cc;
const departSpark = 0xeef4fc;
/** 犯困 ZZZ，偏蓝灰易辨认 */
const sleepyZColor = 0x4a5f78;
/** 生病头晕：螺旋 + 金星（浅色、弱对比） */
const dizzyGlow = 0xf5f3ff;
const dizzySpiral = 0xb39ddb;
const dizzyStar = 0xffe082;
/** 饥饿：暖橙波浪（肚子叫）+ 空碗轮廓 */
const hungryWarm = 0xffab91;
const hungryDeep = 0xff7043;
const hungryBowl = 0xd84315;

/**
 * GLB 内真实 clip 名（与 react-host `kanshanClipAliasMap` 语义→原始 一致）。
 * 语义 Breakdance_1990 → Dozing_Elderly；语义 Hip_Hop_Dance → Gangnam_Groove。
 * 勿写 Hip_Hop_Dance：该原始名对应语义 Walking，会误触发音符。
 */
const CLIPS_WITH_MUSIC_NOTES = new Set(['Dozing_Elderly', 'Gangnam_Groove']);

const slotOffsets: Record<PetSlot, [number, number, number]> = {
  head: [-0.2, 1.06, 0.5],
  mouth: [0.68, 0.4, 0.5],
  'hand-left': [-0.86, 0.0, 0.5],
  'hand-right': [0.86, 0.2, 0.5],
  tail: [-0.72, -0.34, 0.5],
  feet: [0.2, -0.82, 0.5],
  emotion: [0.24, 1.0, 0.5],
};

export class KanshanThreeRuntime implements KanshanRuntimeBridge {
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.OrthographicCamera;
  private readonly environmentTexture: THREE.CanvasTexture;
  private readonly clock = new THREE.Clock();
  private readonly listeners = new Set<(event: PetRuntimeEvent) => void>();
  private readonly modelRoot = new THREE.Group();
  private readonly slotRoot = new THREE.Group();
  private readonly slots: SlotMap;
  private readonly modelBasePosition = new THREE.Vector3();
  private readonly materialMode: KanshanMaterialMode;
  private readonly clipMap: Partial<Record<PetAction, readonly KanshanClipPreference[]>>;
  private readonly random: () => number;
  private mixer: THREE.AnimationMixer | null = null;
  private modelClips: THREE.AnimationClip[] = [];
  private modelAction: THREE.AnimationAction | null = null;
  private modelScene: THREE.Object3D | null = null;
  private readonly modelInitialTransforms = new Map<THREE.Object3D, { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 }>();
  private activeActionEnd: PetAction | null = null;
  private activeRawClipEnd: string | null = null;
  private activeMixerAction: THREE.AnimationAction | null = null;
  private readonly equippedProps = new Map<PetSlot, THREE.Object3D>();
  private frameId = 0;
  private disposed = false;
  private currentAction: PetAction = 'idle';
  private currentYaw = 0;
  private effect: THREE.Object3D | null = null;
  private effectStartedAt = 0;
  private effectDuration = 1.2;
  private effectBaseScale = 1;
  /** 当前播放中的特效类型（用于单独调节淡出/缩放） */
  private activeEffectId: EffectId | null = null;
  /** 死亡通知：灵魂离体向上飘散 */
  private soulFloatRoot: THREE.Group | null = null;

  constructor(options: KanshanThreeRuntimeOptions) {
    this.canvas = options.canvas;
    this.materialMode = options.materialMode ?? 'texture';
    this.clipMap = options.clipMap ?? {};
    this.random = options.random ?? Math.random;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(options.pixelRatio ?? Math.min(window.devicePixelRatio, 3));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.LinearToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.environmentTexture = createNeutralStudioEnvironmentTexture();
    this.scene.environment = this.environmentTexture;

    this.camera = new THREE.OrthographicCamera(-2, 2, 1.85, -1.65, 0.1, 20);
    this.camera.position.set(0, 0, 8);
    this.camera.lookAt(0, 0, 0);

    this.addStage();
    this.addLights();
    this.slots = createSlotMap();
    for (const slot of petSlots) {
      this.slotRoot.add(this.slots[slot]);
    }
    this.scene.add(this.modelRoot);
    this.scene.add(this.slotRoot);

    if (options.modelUrl) {
      this.loadModel(options.modelUrl);
    }

    this.resize();
    this.animate();
  }

  send(command: PetCommand): void {
    const result = validatePetCommand(command);
    if (!result.ok) {
      this.emit({ type: 'error', code: 'INVALID_COMMAND', message: result.errors.join(' ') });
      return;
    }
    this.handleCommand(result.command);
  }

  resize(): void {
    const width = this.canvas.clientWidth || this.canvas.parentElement?.clientWidth || 800;
    const height = this.canvas.clientHeight || this.canvas.parentElement?.clientHeight || 560;
    const aspect = width / height;
    const halfHeight = 1.8;
    this.camera.left = -halfHeight * aspect;
    this.camera.right = halfHeight * aspect;
    this.camera.top = halfHeight;
    this.camera.bottom = -halfHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  onEvent(listener: (event: PetRuntimeEvent) => void): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    window.setTimeout(() => listener({ type: 'ready' }), 0);
    return () => {
      this.listeners.delete(listener);
    };
  }

  destroy(): void {
    this.dispose();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.cancelAnimationFrame(this.frameId);
    this.disposeMixer();
    this.listeners.clear();
    disposeObject(this.scene);
    this.environmentTexture.dispose();
    this.renderer.dispose();
  }

  private handleCommand(command: PetCommand): void {
    switch (command.type) {
      case 'setDirection': {
        const yaw = normalizeYaw(command.yaw);
        this.currentYaw = yaw;
        const yawRadians = THREE.MathUtils.degToRad(yaw);
        this.modelRoot.rotation.y = yawRadians;
        this.slotRoot.rotation.y = yawRadians;
        this.emit({ type: 'directionChanged', yaw });
        break;
      }
      case 'playAction':
        if (command.action !== 'death-notice') this.clearDeathNoticePresentation();
        this.currentAction = command.action;
        this.emit({ type: 'actionStart', action: command.action });
        if (command.action === 'death-notice') this.enterDeathNoticePresentation();
        this.playActionClip(command.action, command.loop ?? false, command.repetitions);
        if (!this.mixer && !command.loop) this.emit({ type: 'actionEnd', action: command.action });
        break;
      case 'playClip':
        this.clearDeathNoticePresentation();
        this.playRawClip(command.clipName, command.loop ?? false, command.repetitions);
        break;
      case 'setMood':
        this.clearDeathNoticePresentation();
        this.currentAction = command.mood === 'normal' ? 'idle' : command.mood;
        this.emit({ type: 'actionStart', action: this.currentAction });
        this.playActionClip(this.currentAction, true);
        break;
      case 'equipProp':
        this.equipProp(command.slot, command.propId);
        this.emit({ type: 'propEquipped', slot: command.slot, propId: command.propId });
        break;
      case 'showEffect':
        this.showEffect(command.effectId, command.slot ?? 'emotion', command.durationMs ?? 1200, 1);
        break;
      case 'setPosition':
        this.modelRoot.position.set(command.x, command.y, command.z ?? 0);
        this.slotRoot.position.set(command.x, command.y, command.z ?? 0);
        this.modelBasePosition.copy(this.modelRoot.position);
        break;
    }
  }

  private loadModel(modelUrl: string): void {
    const loader = new GLTFLoader();
    loader.load(
      modelUrl,
      (gltf) => {
        if (this.disposed) return;
        this.modelRoot.clear();
        const model = gltf.scene;
        model.name = 'KanshanLoadedGlb';
        normalizeModel(model);
        this.prepareModelMaterials(model);
        this.modelRoot.add(model);
        this.modelScene = model;
        this.captureInitialModelTransforms(model);
        this.modelBasePosition.copy(this.modelRoot.position);
        this.modelClips = gltf.animations;
        this.validateConfiguredClips();
        this.playActionClip(this.currentAction, true);
      },
      (progress) => {
        if (this.disposed) return;
        this.emit({
          type: 'modelLoadProgress',
          loaded: progress.loaded ?? 0,
          total: progress.total ?? 0,
        });
      },
      (error) => {
        this.emit({ type: 'error', code: 'MODEL_LOAD_FAILED', message: error instanceof Error ? error.message : String(error) });
      },
    );
  }

  private prepareModelMaterials(model: THREE.Object3D): void {
    model.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.castShadow = true;
      child.receiveShadow = true;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      child.material = materials.map((material) => normalizeLoadedMaterial(material, this.materialMode));
      if (child.material.length === 1) child.material = child.material[0] as THREE.Material;
    });
  }

  private playActionClip(action: PetAction, loop: boolean, repetitions?: number): void {
    if (!this.modelScene || this.modelClips.length === 0) return;
    const clip = findModelClip(this.modelClips, action, this.clipMap[action], this.random);
    if (!clip) {
      this.emit({
        type: 'error',
        code: 'UNKNOWN_ANIMATION_CLIP',
        message: `No GLB animation clip configured for action: ${action}.`,
      });
      return;
    }
    this.playClip(clip, loop, repetitions);
    this.triggerMusicNotesIfDanceClip(clip.name, action);
    this.triggerZhihuSportCheerIfRun(action);
    if (action === 'sleepy') {
      this.triggerSleepyZzzEffect();
    }
    if (action === 'sick') {
      this.triggerSickDizzyEffect();
    }
    if (action === 'hungry') {
      this.triggerHungryGrowlEffect();
    }
    if (action === 'happy' && !CLIPS_WITH_MUSIC_NOTES.has(clip.name)) {
      this.triggerHappyHeartAndFingerHeart();
    }
    this.activeActionEnd = loop && !repetitions ? null : action;
    this.activeRawClipEnd = null;
    this.emit({ type: 'animationClipStart', action, clipName: clip.name, durationMs: getClipPlaybackDurationMs(clip, loop, repetitions), loop: loop && !repetitions });
  }

  private playRawClip(clipName: string, loop: boolean, repetitions?: number): void {
    if (!this.modelScene || this.modelClips.length === 0) return;
    const clip = findExactClip(this.modelClips, clipName);
    if (!clip) {
      this.emit({ type: 'error', code: 'UNKNOWN_RAW_ANIMATION_CLIP', message: `No GLB animation clip named: ${clipName}.` });
      return;
    }
    this.playClip(clip, loop, repetitions);
    this.triggerMusicNotesIfDanceClip(clip.name, this.currentAction);
    this.activeActionEnd = null;
    this.activeRawClipEnd = loop && !repetitions ? null : clip.name;
    this.emit({ type: 'rawClipStart', clipName: clip.name, durationMs: getClipPlaybackDurationMs(clip, loop, repetitions), loop: loop && !repetitions });
  }

  private playClip(clip: THREE.AnimationClip, loop: boolean, repetitions?: number): void {
    this.restoreInitialModelTransforms();
    const mixer = this.createFreshMixer();
    if (!mixer) return;
    const nextAction = mixer.clipAction(clip);
    nextAction.reset().setEffectiveWeight(1);
    const loopCount = repetitions ?? (loop ? Infinity : 1);
    nextAction.clampWhenFinished = loopCount !== Infinity;
    nextAction.setLoop(loopCount === 1 ? THREE.LoopOnce : THREE.LoopRepeat, loopCount);
    nextAction.play();
    mixer.setTime(0);
    this.modelScene?.updateMatrixWorld(true);
    this.modelAction = nextAction;
    this.activeMixerAction = nextAction;
  }

  private captureInitialModelTransforms(model: THREE.Object3D): void {
    this.modelInitialTransforms.clear();
    model.traverse((object) => {
      this.modelInitialTransforms.set(object, {
        position: object.position.clone(),
        quaternion: object.quaternion.clone(),
        scale: object.scale.clone(),
      });
    });
  }

  private restoreInitialModelTransforms(): void {
    for (const [object, transform] of this.modelInitialTransforms) {
      object.position.copy(transform.position);
      object.quaternion.copy(transform.quaternion);
      object.scale.copy(transform.scale);
      object.updateMatrix();
    }
    this.modelScene?.updateMatrixWorld(true);
  }

  private handleAnimationFinished = (event: { action: THREE.AnimationAction }): void => {
    if (event.action !== this.activeMixerAction) return;

    if (this.activeActionEnd) {
      const action = this.activeActionEnd;
      this.activeActionEnd = null;
      this.activeMixerAction = null;
      this.emit({ type: 'actionEnd', action });
    }

    if (this.activeRawClipEnd) {
      const clipName = this.activeRawClipEnd;
      this.activeRawClipEnd = null;
      this.activeMixerAction = null;
      this.emit({ type: 'rawClipEnd', clipName });
    }
  };

  private createFreshMixer(): THREE.AnimationMixer | null {
    if (!this.modelScene) return null;
    this.disposeMixer();
    this.mixer = new THREE.AnimationMixer(this.modelScene);
    this.mixer.addEventListener('finished', this.handleAnimationFinished);
    return this.mixer;
  }

  private disposeMixer(): void {
    if (!this.mixer) return;
    this.mixer.removeEventListener('finished', this.handleAnimationFinished);
    this.mixer.stopAllAction();
    if (this.modelScene) this.mixer.uncacheRoot(this.modelScene);
    this.mixer = null;
    this.modelAction = null;
    this.activeMixerAction = null;
  }

  private validateConfiguredClips(): void {
    const clipNames = this.modelClips.map((clip) => clip.name);
    const clipNameSet = new Set(clipNames);
    const configuredClipNames = Object.values(this.clipMap).flatMap((names) => (names ?? []).map((clip) => getPreferredClipName(clip)));
    const missingClipNames = configuredClipNames.filter((name) => !clipNameSet.has(name));

    this.emit({ type: 'animationClipMapReady', clipNames, missingClipNames });

    if (missingClipNames.length > 0) {
      this.emit({
        type: 'error',
        code: 'ANIMATION_CLIP_MAP_INVALID',
        message: `Missing GLB animation clips: ${missingClipNames.join(', ')}.`,
      });
    }
  }

  private equipProp(slot: PetSlot, propId: string | null): void {
    const existing = this.equippedProps.get(slot);
    if (existing) {
      existing.parent?.remove(existing);
      disposeObject(existing);
      this.equippedProps.delete(slot);
    }
    if (!propId) return;

    const prop = createProp(propId);
    if (!prop) {
      this.emit({ type: 'error', code: 'UNKNOWN_PROP', message: `Unknown prop: ${propId}.` });
      return;
    }

    this.slots[slot].add(prop);
    this.equippedProps.set(slot, prop);
  }

  private enterDeathNoticePresentation(): void {
    if (this.soulFloatRoot) return;
    const soul = createSoulLeavingEffect();
    soul.name = 'DeathNoticeSoulLeaving';
    this.slots.head.add(soul);
    soul.position.set(0.02, -0.16, 0.2);
    this.soulFloatRoot = soul;
  }

  private clearDeathNoticePresentation(): void {
    if (!this.soulFloatRoot) return;
    this.soulFloatRoot.parent?.remove(this.soulFloatRoot);
    disposeObject(this.soulFloatRoot);
    this.soulFloatRoot = null;
  }

  private applySoulLeavingAnimation(elapsed: number): void {
    if (!this.soulFloatRoot) return;
    const cycle = 2.55;
    const rootPhase = (this.soulFloatRoot.userData.phase as number) ?? 0;
    this.soulFloatRoot.children.forEach((child, index) => {
      const offset = (child.userData.offset as number) ?? 0;
      const drift = (child.userData.drift as number) ?? 0.2;
      const t = (elapsed * drift + offset + rootPhase) % cycle;
      const u = t / cycle;
      const depart = u * u * (3 - 2 * u);
      const rise = -0.12 + depart * 1.78;
      const pulse = Math.sin(u * Math.PI);
      const base = (child.userData.opacityBase as number) ?? 0.5;
      const breathe = 0.92 + pulse * 0.18 + Math.sin(elapsed * 2.1 + offset) * 0.035;
      const role = (child.userData.soulRole as string) ?? 'core';

      if (child instanceof THREE.Mesh) {
        child.position.y = rise + ((child.userData.yBias as number) ?? 0);
        child.position.x =
          Math.sin(elapsed * 2.05 + offset) * 0.12 +
          Math.cos(elapsed * 1.15 + offset * 0.5) * 0.07 +
          ((index % 5) - 2) * 0.035;
        child.position.z =
          0.032 + Math.sin(elapsed * 1.55 + offset) * 0.075 + Math.cos(elapsed * 1.75 + index) * 0.048;
        child.rotation.z = Math.sin(elapsed * 1.85 + offset) * 0.32 + Math.cos(elapsed * 0.85 + offset * 0.35) * 0.14;

        let opacityMul = 1;
        let scaleMul = 0.84 + depart * 0.2;
        if (role === 'tether') {
          opacityMul = Math.max(0.08, 1 - u * 1.05);
          scaleMul = 0.78 + u * 0.18;
        } else if (role === 'spark') {
          const reveal = Math.max(0, Math.min(1, (u - 0.12) / 0.78));
          opacityMul = 0.28 + 0.72 * reveal;
          scaleMul = 0.72 + depart * 0.26;
        } else {
          opacityMul = 0.36 + 0.62 * depart;
        }

        setOpacity(child, Math.min(0.94, base * opacityMul + pulse * (role === 'tether' ? 0.06 : 0.18)));
        child.scale.setScalar((child.userData.baseScale as number) * breathe * scaleMul);
      }
    });
  }

  private applyDeathNoticeSoulDrift(elapsed: number): void {
    const sway = Math.sin(elapsed * 1.45);
    const bob = Math.sin(elapsed * 2.35) * 0.026;
    this.modelRoot.position.copy(this.modelBasePosition);
    this.modelRoot.position.y += bob;
    this.modelRoot.rotation.y = THREE.MathUtils.degToRad(this.currentYaw) + sway * 0.058;
    this.modelRoot.rotation.x = -0.085 + Math.sin(elapsed * 0.92) * 0.028;
    this.modelRoot.rotation.z = Math.sin(elapsed * 1.15) * 0.048;
  }

  private triggerHappyHeartAndFingerHeart(): void {
    this.showEffect('heart', 'emotion', 2600, 0.82);
  }

  private triggerMusicNotesIfDanceClip(clipName: string, action: PetAction): void {
    if (action === 'sleepy') return;
    if (!CLIPS_WITH_MUSIC_NOTES.has(clipName)) return;
    this.showEffect('music-note', 'emotion', 2400, 0.92);
  }

  /** 运动（run）时为知乎运动健儿打 call：知乎蓝星光粒子 */
  private triggerZhihuSportCheerIfRun(action: PetAction): void {
    if (action !== 'run') return;
    this.showEffect('zhihu-call', 'emotion', 3600, 1.78);
  }

  /** 犯困：头顶飘起 ZZZ 瞌睡符号 */
  private triggerSleepyZzzEffect(): void {
    this.showEffect('sleepy-zzz', 'head', 4500, 1.55);
  }

  /** 生病：头晕（螺旋 + 金星） */
  private triggerSickDizzyEffect(): void {
    this.showEffect('sick-dizzy', 'emotion', 4300, 1.12);
  }

  /** 饥饿：肚子咕咕波浪 + 空碗 */
  private triggerHungryGrowlEffect(): void {
    this.showEffect('hungry-growl', 'emotion', 4000, 1.32);
  }

  private showEffect(effectId: string, slot: PetSlot, durationMs: number, initialScale = 1): void {
    if (this.effect) {
      this.effect.parent?.remove(this.effect);
      disposeObject(this.effect);
      this.effect = null;
    }
    this.activeEffectId = effectId as EffectId;
    this.effectBaseScale = initialScale;
    const effect = createEffect(effectId as EffectId);
    effect.scale.setScalar(initialScale);
    this.effect = effect;
    this.effectStartedAt = this.clock.elapsedTime;
    this.effectDuration = durationMs / 1000;
    this.slots[slot].add(effect);
  }

  private addStage(): void {
    const shadow = ellipse(ink, 1.45, 0.2, -0.05);
    shadow.position.set(0, -1.16, -1);
    shadow.material.opacity = 0.12;
    shadow.material.transparent = true;
    this.scene.add(shadow);
  }

  private addLights(): void {
    const ambient = new THREE.HemisphereLight(0xf0f0f0, 0x8f887f, 0.32);
    const key = new THREE.DirectionalLight(0xffffff, 1.65);
    key.position.set(-3.5, 4.5, 6);
    const fill = new THREE.DirectionalLight(0xf2eee4, 0.18);
    fill.position.set(3, 1.4, 3);
    const rim = new THREE.DirectionalLight(0xffffff, 1.15);
    rim.position.set(3.5, 3, 4.5);
    this.scene.add(ambient, key, fill, rim);
  }

  private animate = (): void => {
    if (this.disposed) return;
    const elapsed = this.clock.elapsedTime;
    const delta = this.clock.getDelta();
    this.mixer?.update(delta);
    if (!this.mixer) this.applyModelMotion(elapsed);
    if (this.currentAction === 'death-notice' && this.mixer) this.applyDeathNoticeSoulDrift(elapsed);
    if (this.currentAction === 'death-notice') this.applySoulLeavingAnimation(elapsed);
    if (this.currentAction === 'happy') this.applyHappyFingerHeart(elapsed);
    else this.resetHappyHandSlots();
    this.applyEffect(elapsed);
    this.renderer.render(this.scene, this.camera);
    this.frameId = window.requestAnimationFrame(this.animate);
  };

  private applyModelMotion(elapsed: number): void {
    if (this.currentAction === 'death-notice') {
      this.applyDeathNoticeSoulDrift(elapsed);
      return;
    }
    const bob = Math.sin(elapsed * 2.6);
    this.modelRoot.rotation.y = THREE.MathUtils.degToRad(this.currentYaw) + Math.sin(elapsed * 0.7) * 0.06;
    this.modelRoot.position.copy(this.modelBasePosition);
    this.modelRoot.position.y += bob * 0.018;

    if (this.currentAction === 'run' || this.currentAction === 'walk') {
      this.modelRoot.rotation.z = Math.sin(elapsed * 7) * 0.035;
      this.modelRoot.position.y += Math.abs(Math.sin(elapsed * 7)) * 0.04;
      return;
    }

    if (this.currentAction === 'happy') {
      this.modelRoot.rotation.z = Math.sin(elapsed * 5) * 0.045;
      this.modelRoot.position.y += Math.abs(Math.sin(elapsed * 5)) * 0.055;
      return;
    }

    if (this.currentAction === 'sleepy' || this.currentAction === 'blink') {
      this.modelRoot.rotation.z = -0.035 + Math.sin(elapsed * 1.6) * 0.01;
      return;
    }

    this.modelRoot.rotation.z = 0;
  }

  private applyHappyFingerHeart(elapsed: number): void {
    const pulse = Math.sin(elapsed * 4.4);
    const lift = 0.22 + pulse * 0.045;
    const inward = 0.2 + pulse * 0.035;
    const [lx, ly, lz] = slotOffsets['hand-left'];
    const [rx, ry, rz] = slotOffsets['hand-right'];
    const hl = this.slots['hand-left'];
    const hr = this.slots['hand-right'];
    hl.position.set(lx + inward, ly + lift, lz);
    hr.position.set(rx - inward, ry + lift * 0.92, rz);
    hl.rotation.z = 0.5 + pulse * 0.07;
    hr.rotation.z = -0.5 - pulse * 0.07;
    hl.rotation.y = 0.12;
    hr.rotation.y = -0.12;
  }

  private resetHappyHandSlots(): void {
    for (const key of ['hand-left', 'hand-right'] as const) {
      const [x, y, z] = slotOffsets[key];
      const slot = this.slots[key];
      slot.position.set(x, y, z);
      slot.rotation.set(0, 0, 0);
    }
  }

  private applyEffect(elapsed: number): void {
    if (!this.effect) return;
    const progress = (elapsed - this.effectStartedAt) / this.effectDuration;
    if (progress >= 1) {
      this.effect.parent?.remove(this.effect);
      disposeObject(this.effect);
      this.effect = null;
      this.effectBaseScale = 1;
      this.activeEffectId = null;
      return;
    }
    const isCheer = this.activeEffectId === 'zhihu-call';
    const isDizzy = this.activeEffectId === 'sick-dizzy';
    this.effect.position.y = progress * (isCheer ? 0.72 : isDizzy ? 0.52 : 0.58);
    const growth = 1 + progress * (this.effectBaseScale < 1 ? 0.28 : isCheer ? 0.14 : 0.18);
    const pulse = isCheer
      ? 1 + 0.11 * Math.sin(elapsed * 12)
      : isDizzy
        ? 1 + 0.06 * Math.sin(elapsed * 10)
        : 1;
    this.effect.scale.setScalar(this.effectBaseScale * growth * pulse);
    if (isDizzy) this.effect.rotation.z = elapsed * 2.65;

    let opacity: number;
    if (isCheer) {
      opacity = progress < 0.48 ? 1 : 1 - (progress - 0.48) / 0.52;
    } else if (isDizzy) {
      opacity = progress < 0.42 ? 1 : 1 - (progress - 0.42) / 0.58;
    } else if (this.effectBaseScale < 1) {
      opacity = progress < 0.45 ? 1 : 1 - (progress - 0.45) / 0.55;
    } else {
      opacity = 1 - progress;
    }
    setOpacity(this.effect, Math.max(0, opacity));
  }

  private emit(event: PetRuntimeEvent): void {
    for (const listener of this.listeners) listener(event);
    window.dispatchEvent(new CustomEvent('kanshan-three-runtime-event', { detail: event }));
  }
}

export function createKanshanThreeRuntime(options: KanshanThreeRuntimeOptions): KanshanThreeRuntime {
  return new KanshanThreeRuntime(options);
}

function createSlotMap(): SlotMap {
  const map = {} as SlotMap;
  for (const slot of petSlots) {
    const [x, y, z] = slotOffsets[slot];
    map[slot] = slotAt(x, y, z);
  }
  return map;
}

function normalizeModel(model: THREE.Object3D): void {
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxAxis = Math.max(size.x, size.y, size.z);
  const scale = maxAxis > 0 ? 2.35 / maxAxis : 1;
  model.scale.setScalar(scale);
  model.position.set(-center.x * scale, -center.y * scale - (size.y * scale) / 2 + 0.92, -center.z * scale);
  model.rotation.set(0, -Math.PI / 10, 0);
}

function findModelClip(
  clips: THREE.AnimationClip[],
  action: PetAction,
  preferredClipNames: readonly KanshanClipPreference[] = [],
  random: () => number = Math.random,
): THREE.AnimationClip | undefined {
  if (preferredClipNames.length > 0) return pickPreferredClip(clips, preferredClipNames, random);
  void action;
  return undefined;
}

function pickPreferredClip(
  clips: THREE.AnimationClip[],
  preferredClipNames: readonly KanshanClipPreference[],
  random: () => number,
): THREE.AnimationClip | undefined {
  if (preferredClipNames.length === 0) return undefined;
  const clipName = pickWeightedClipName(preferredClipNames, random);
  if (!clipName) return undefined;
  return findExactClip(clips, clipName);
}

function pickWeightedClipName(preferredClipNames: readonly KanshanClipPreference[], random: () => number): string | undefined {
  const weightedClipNames = preferredClipNames.map((clip) => ({
    clipName: getPreferredClipName(clip),
    weight: getPreferredClipWeight(clip),
  }));
  const totalWeight = weightedClipNames.reduce((sum, clip) => sum + clip.weight, 0);

  if (totalWeight <= 0) return undefined;

  let cursor = random() * totalWeight;
  for (const clip of weightedClipNames) {
    cursor -= clip.weight;
    if (cursor < 0) return clip.clipName;
  }

  return weightedClipNames[weightedClipNames.length - 1]?.clipName;
}

function getPreferredClipName(clip: KanshanClipPreference): string {
  return typeof clip === 'string' ? clip : clip.clipName;
}

function getPreferredClipWeight(clip: KanshanClipPreference): number {
  if (typeof clip === 'string') return 1;
  return Number.isFinite(clip.weight) && clip.weight !== undefined && clip.weight > 0 ? clip.weight : 0;
}

function getClipPlaybackDurationMs(clip: THREE.AnimationClip, loop: boolean, repetitions?: number): number | undefined {
  if (loop && !repetitions) return undefined;
  const loopCount = repetitions ?? 1;
  return Math.max(0, clip.duration * loopCount * 1000);
}

function findExactClip(clips: THREE.AnimationClip[], clipName: string): THREE.AnimationClip | undefined {
  return clips.find((clip) => clip.name === clipName);
}

function normalizeLoadedMaterial(material: THREE.Material, materialMode: KanshanMaterialMode): THREE.Material {
  material.side = THREE.DoubleSide;

  if (!(material instanceof THREE.MeshStandardMaterial)) {
    material.needsUpdate = true;
    return material;
  }

  const colorMap = material.map ?? material.emissiveMap;
  if (colorMap) {
    colorMap.colorSpace = THREE.SRGBColorSpace;
    colorMap.flipY = false;
  }

  if (material.alphaMap) {
    material.alphaMap.flipY = false;
  }

  if (!material.map && material.emissiveMap) {
    material.map = material.emissiveMap;
  }

  if (materialMode === 'toon-bw' && material.map) {
    const toonMaterial = createBlackWhiteTextureMaterial(material);
    if (toonMaterial) return toonMaterial;
  }

  if (materialMode === 'texture' && material.map) {
    const textureMaterial = new THREE.MeshBasicMaterial({
      alphaMap: material.alphaMap,
      alphaTest: material.alphaTest,
      map: material.map,
      opacity: material.opacity,
      side: THREE.DoubleSide,
      transparent: material.transparent,
    });
    textureMaterial.name = material.name;
    return textureMaterial;
  }

  material.transparent = material.opacity < 1 || Boolean(material.alphaMap);
  material.depthWrite = !material.transparent;
  material.alphaTest = Math.max(material.alphaTest, 0.04);
  material.envMapIntensity = resolveEnvironmentIntensity(material);
  material.needsUpdate = true;
  return material;
}

function resolveEnvironmentIntensity(material: THREE.MeshStandardMaterial): number {
  const brightness = Math.max(material.color.r, material.color.g, material.color.b);
  return brightness > 0.72 ? 0.22 : 1.45;
}

function createNeutralStudioEnvironmentTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 32;
  const context = canvas.getContext('2d');

  if (context) {
    context.fillStyle = '#d9d9d9';
    context.fillRect(0, 0, canvas.width, canvas.height);

    const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(0.34, '#eeeeee');
    gradient.addColorStop(0.68, '#777777');
    gradient.addColorStop(1, '#17191c');
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.fillStyle = '#ffffff';
    context.fillRect(4, 2, 14, 5);
    context.fillStyle = '#f8f8f8';
    context.fillRect(40, 3, 10, 4);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createBlackWhiteTextureMaterial(material: THREE.MeshStandardMaterial): THREE.ShaderMaterial | null {
  const map = material.map;
  if (!map) return null;

  return new THREE.ShaderMaterial({
    name: material.name,
    side: THREE.DoubleSide,
    transparent: material.transparent,
    uniforms: {
      map: { value: map },
      threshold: { value: 0.58 },
      whiteColor: { value: new THREE.Color(0xffffff) },
      blackColor: { value: new THREE.Color(0x050505) },
    },
    vertexShader: `
      varying vec2 vUv;

      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D map;
      uniform float threshold;
      uniform vec3 whiteColor;
      uniform vec3 blackColor;
      varying vec2 vUv;

      void main() {
        vec4 texel = texture2D(map, vUv);
        float luma = dot(texel.rgb, vec3(0.299, 0.587, 0.114));
        vec3 color = mix(blackColor, whiteColor, step(threshold, luma));
        gl_FragColor = vec4(color, texel.a);
      }
    `,
  });
}

function createProp(propId: string): THREE.Object3D | null {
  if (propId === 'holiday-hat') return createHolidayHat();
  if (propId === 'baton') return createBaton();
  if (propId === 'skateboard') return createSkateboardProp();
  return null;
}

/**
 * 死亡通知：人死魂离——躯壳下牵绊缕线 + 渐冷的灵团升空（动画里缕断、魂显）。
 */
function createSoulLeavingEffect(): THREE.Group {
  const root = new THREE.Group();
  root.userData.phase = 0;
  const S = 1.5;
  const zb = 0.006;
  const zm = 0.016;
  const zf = 0.026;

  const pushMesh = (
    mesh: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>,
    opts: { off: number; drift: number; op: number; yBias?: number; role?: 'core' | 'tether' | 'spark' },
  ): void => {
    mesh.userData.offset = opts.off;
    mesh.userData.drift = opts.drift;
    mesh.userData.baseScale = 1;
    mesh.userData.opacityBase = opts.op;
    mesh.userData.yBias = opts.yBias ?? 0;
    mesh.userData.soulRole = opts.role ?? 'core';
    root.add(mesh);
  };

  for (let ti = 0; ti < 5; ti += 1) {
    const rx = (0.018 + (ti % 3) * 0.005) * S;
    const ry = (0.055 + (ti % 2) * 0.018) * S;
    const strand = ellipse(departTetherLine, rx, ry, zb - 0.003 + ti * 0.002);
    strand.material.transparent = true;
    strand.material.opacity = 0.28 + (ti % 3) * 0.08;
    strand.position.set(((ti % 5) - 2) * 0.034 * S, (-0.14 - ti * 0.022) * S, -ti * 0.008);
    strand.rotation.z = ((ti % 5) - 2) * 0.12;
    pushMesh(strand, {
      off: ti * 0.06,
      drift: 0.17 + ti * 0.018,
      op: strand.material.opacity,
      role: 'tether',
    });
  }

  const haloOuter = ellipse(departOuterMist, 0.138 * S, 0.148 * S, zb);
  haloOuter.material.transparent = true;
  haloOuter.material.opacity = 0.22;
  haloOuter.position.y = 0.015 * S;
  pushMesh(haloOuter, { off: 0, drift: 0.19, op: 0.22 });

  const haloInner = ellipse(departSoulBody, 0.105 * S, 0.118 * S, zb + 0.004);
  haloInner.material.transparent = true;
  haloInner.material.opacity = 0.32;
  haloInner.position.y = 0.018 * S;
  pushMesh(haloInner, { off: 0.02, drift: 0.193, op: 0.32 });

  const torso = ellipse(departWarmFaint, 0.098 * S, 0.058 * S, zm);
  torso.material.transparent = true;
  torso.material.opacity = 0.42;
  torso.position.y = -0.058 * S;
  pushMesh(torso, { off: 0.06, drift: 0.2, op: 0.42 });

  const chest = ellipse(departCoreChill, 0.072 * S, 0.068 * S, zm + 0.003);
  chest.material.transparent = true;
  chest.material.opacity = 0.52;
  chest.position.y = -0.008 * S;
  pushMesh(chest, { off: 0.09, drift: 0.2, op: 0.52 });

  const head = ellipse(0xfafcff, 0.056 * S, 0.062 * S, zf);
  head.material.transparent = true;
  head.material.opacity = 0.62;
  head.position.y = 0.048 * S;
  pushMesh(head, { off: 0.12, drift: 0.2, op: 0.62 });

  const crown = ellipse(white, 0.026 * S, 0.028 * S, zf + 0.006);
  crown.material.transparent = true;
  crown.material.opacity = 0.42;
  crown.position.y = 0.09 * S;
  pushMesh(crown, { off: 0.14, drift: 0.2, op: 0.42 });

  for (const side of [-1, 1] as const) {
    const e = ellipse(ink, 0.014 * S, 0.018 * S, zf + 0.008);
    e.position.set(side * 0.024 * S, 0.04 * S, 0.012);
    e.material.transparent = true;
    e.material.opacity = 0.62;
    pushMesh(e, { off: 0.11, drift: 0.2, op: 0.62 });
  }

  const sparks = [departSpark, departCoreChill, departSoulBody, departWarmFaint, 0xdce6f5, 0xc9d8ee, white];
  for (let j = 0; j < 8; j += 1) {
    const m = ellipse(
      sparks[j % sparks.length]!,
      (0.022 + (j % 5) * 0.012) * S,
      (0.02 + (j % 4) * 0.01) * S,
      zm - 0.005 + (j % 6) * 0.002,
    );
    m.material.transparent = true;
    m.material.opacity = 0.32 + (j % 3) * 0.12;
    m.userData.offset = 0.42 + j * 0.32;
    m.userData.drift = 0.13 + (j % 7) * 0.026;
    m.userData.baseScale = 0.78 + (j % 5) * 0.06;
    m.userData.opacityBase = m.material.opacity;
    m.userData.yBias = -0.026 * j * S * 0.13;
    m.userData.soulRole = 'spark';
    root.add(m);
  }

  return root;
}

function createHolidayHat(): THREE.Group {
  const hat = new THREE.Group();
  const cone = new THREE.Shape();
  cone.moveTo(-0.16, 0);
  cone.lineTo(0.02, 0.34);
  cone.lineTo(0.14, 0);
  cone.lineTo(-0.16, 0);
  hat.add(shapeMesh(cone, heartRed, 0.1), strokePath([[-0.18, 0], [0.16, 0]], 0.024, ink, 0.14));
  const pom = ellipse(white, 0.045, 0.045, 0.16);
  pom.position.set(0.02, 0.34, 0);
  hat.add(pom);
  return hat;
}

function createBaton(): THREE.Group {
  const baton = new THREE.Group();
  baton.add(strokePath([[0, 0.28], [0.06, -0.28]], 0.018, ink, 0.1));
  const tip = ellipse(heartRed, 0.035, 0.035, 0.14);
  tip.position.set(0, 0.28, 0);
  baton.add(tip);
  return baton;
}

function createSkateboardProp(): THREE.Group {
  const board = new THREE.Group();
  board.add(outlinedRoundedRect(0.7, 0.12, 0.06, 0.1, boardBrown));
  return board;
}

function createEffect(effectId: EffectId): THREE.Object3D {
  if (effectId === 'heart') return createHeart();
  if (effectId === 'sweat') return createDrop();
  if (effectId === 'zhihu-call') return createZhihuSportCheerEffect();
  if (effectId === 'sleepy-zzz') return createSleepyZzzEffect();
  if (effectId === 'sick-dizzy') return createDizzinessEffect();
  if (effectId === 'hungry-growl') return createHungryGrowlEffect();
  return createMusicNote();
}

/** 经典桃心参数曲线：x=16sin³t，y=13cos t − 5cos2t − 2cos3t − cos4t（常见 ♥ 轮廓） */
function createHeart(): THREE.Group {
  const heart = new THREE.Group();
  const shape = new THREE.Shape();
  const segments = 56;
  const scale = 0.0195;
  for (let i = 0; i <= segments; i += 1) {
    const t = (i / segments) * Math.PI * 2;
    const px = 16 * Math.pow(Math.sin(t), 3);
    const py = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    const x = px * scale;
    const y = py * scale;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  heart.add(shapeMesh(shape, heartRed, 0.2));
  return heart;
}

function createDrop(): THREE.Group {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.16);
  shape.bezierCurveTo(-0.13, -0.02, -0.1, -0.18, 0, -0.18);
  shape.bezierCurveTo(0.1, -0.18, 0.13, -0.02, 0, 0.16);
  const drop = new THREE.Group();
  drop.add(shapeMesh(shape, sweatBlue, 0.2));
  return drop;
}

function createMusicNote(): THREE.Group {
  const note = new THREE.Group();
  note.add(strokePath([[0, 0.16], [0, -0.1]], 0.016, ink, 0.2));
  const head = ellipse(ink, 0.055, 0.038, 0.22);
  head.position.set(-0.04, -0.1, 0);
  note.add(head);
  return note;
}

function letterZStroke(w: number, h: number, r: number, color: number, z: number): THREE.Group {
  const hw = w / 2;
  const hh = h / 2;
  return strokePath(
    [
      [-hw, hh],
      [hw, hh],
      [-hw, -hh],
      [hw, -hh],
    ],
    r,
    color,
    z,
  );
}

function hungryWavyLine(
  y: number,
  length: number,
  amp: number,
  phase: number,
  color: number,
  z: number,
  lineW: number,
): THREE.Group {
  const steps = 20;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const x = -length / 2 + t * length;
    pts.push([x, y + amp * Math.sin(phase + t * 3.6 * Math.PI)]);
  }
  return strokePath(pts, lineW, color, z);
}

/** 波浪线 + 向上开口小碗（漫画里肚子饿 / 空肚子） */
function createHungryGrowlEffect(): THREE.Group {
  const root = new THREE.Group();
  root.position.set(0.02, 0.06, 0.1);
  const z0 = 0.12;
  root.add(hungryWavyLine(0.14, 0.26, 0.022, 0.2, hungryWarm, z0, 0.014));
  root.add(hungryWavyLine(0.1, 0.24, 0.018, 1.1, hungryDeep, z0 + 0.005, 0.013));
  root.add(hungryWavyLine(0.06, 0.22, 0.016, 2.3, hungryWarm, z0 + 0.01, 0.012));

  const bowl = strokePath(
    [
      [-0.09, 0.0],
      [-0.05, -0.05],
      [0, -0.075],
      [0.05, -0.05],
      [0.09, 0.0],
    ],
    0.016,
    hungryBowl,
    z0 - 0.01,
  );
  root.add(bowl);
  const bowlInner = ellipse(hungryDeep, 0.045, 0.018, z0 - 0.008);
  bowlInner.material.opacity = 0.35;
  bowlInner.material.transparent = true;
  bowlInner.position.set(0, -0.038, 0);
  root.add(bowlInner);

  return root;
}

/** 三枚 Z 斜向上升，经典瞌睡符号 */
function createSleepyZzzEffect(): THREE.Group {
  const root = new THREE.Group();
  root.position.set(0.1, 0.2, 0.12);
  const z1 = letterZStroke(0.22, 0.17, 0.022, sleepyZColor, 0.16);
  z1.position.set(0, -0.05, 0);
  z1.rotation.z = -0.05;
  const z2 = letterZStroke(0.16, 0.13, 0.018, sleepyZColor, 0.18);
  z2.position.set(0.11, 0.11, 0);
  z2.rotation.z = 0.07;
  const z3 = letterZStroke(0.12, 0.1, 0.015, sleepyZColor, 0.2);
  z3.position.set(0.22, 0.26, 0);
  z3.rotation.z = -0.06;
  root.add(z1, z2, z3);
  return root;
}

/** 阿基米德螺旋线 + 金星（卡通「眼冒金星 / 天旋地转」） */
function createDizzinessEffect(): THREE.Group {
  const root = new THREE.Group();
  root.position.z = 0.11;
  const z0 = 0.11;

  const halo = ellipse(dizzyGlow, 0.14, 0.14, z0 - 0.03);
  halo.material.opacity = 0.28;
  halo.material.transparent = true;
  root.add(halo);

  const steps = 40;
  const turns = 2.25;
  const k = 0.023;
  const spiralPts: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i += 1) {
    const u = (i / steps) * turns * Math.PI * 2;
    const r = k * u;
    spiralPts.push([Math.cos(u) * r, Math.sin(u) * r]);
  }
  root.add(strokePath(spiralPts, 0.013, dizzySpiral, z0 + 0.02));

  const starStroke = (cx: number, cy: number, size: number, z: number): THREE.Group => {
    const g = new THREE.Group();
    const s = size;
    const w = 0.009;
    g.add(strokePath([[-s, 0], [s, 0]], w, dizzyStar, z));
    g.add(strokePath([[0, -s], [0, s]], w, dizzyStar, z));
    g.add(strokePath([[-s * 0.68, -s * 0.68], [s * 0.68, s * 0.68]], w * 0.85, dizzyStar, z + 0.005));
    g.add(strokePath([[s * 0.68, -s * 0.68], [-s * 0.68, s * 0.68]], w * 0.85, dizzyStar, z + 0.005));
    g.position.set(cx, cy, 0);
    return g;
  };

  root.add(starStroke(0.12, 0.08, 0.035, z0 + 0.03));
  root.add(starStroke(-0.1, 0.11, 0.03, z0 + 0.03));
  root.add(starStroke(0.065, -0.09, 0.026, z0 + 0.03));

  return root;
}

/** 大号星光环 + 放射线，知乎蓝高对比，便于辨认「打 call」 */
function createZhihuSportCheerEffect(): THREE.Group {
  const root = new THREE.Group();
  root.position.z = 0.12;
  const ringOuter = ellipse(0x005eb8, 0.14, 0.14, 0.08);
  ringOuter.material.opacity = 0.55;
  ringOuter.material.transparent = true;
  root.add(ringOuter);
  const ringInner = ellipse(zhihuBlue, 0.11, 0.11, 0.1);
  ringInner.material.opacity = 0.88;
  ringInner.material.transparent = true;
  root.add(ringInner);

  const pts: Array<[number, number, number, number]> = [
    [0, 0.16, 0.095, 0.095],
    [-0.22, 0.04, 0.078, 0.078],
    [0.2, -0.07, 0.082, 0.082],
    [-0.1, -0.2, 0.068, 0.068],
    [0.14, 0.22, 0.074, 0.074],
    [-0.18, -0.14, 0.065, 0.065],
    [0.22, 0.12, 0.06, 0.06],
    [-0.06, 0.24, 0.058, 0.058],
  ];
  for (let i = 0; i < pts.length; i += 1) {
    const [x, y, rx, ry] = pts[i]!;
    const col = i % 2 === 0 ? zhihuBlue : white;
    const d = ellipse(col, rx, ry, 0.12 + (i % 5) * 0.006);
    d.position.set(x, y, 0);
    root.add(d);
  }

  const rayR = 0.024;
  for (let a = 0; a < 8; a += 1) {
    const ang = (a / 8) * Math.PI * 2;
    const len = 0.2 + (a % 2) * 0.05;
    const c = a % 2 === 0 ? zhihuBlue : white;
    root.add(
      strokePath(
        [[0, 0], [Math.cos(ang) * len, Math.sin(ang) * len]],
        rayR,
        c,
        0.14 + a * 0.004,
      ),
    );
  }

  const core = ellipse(white, 0.09, 0.09, 0.22);
  core.material.opacity = 0.95;
  core.material.transparent = true;
  root.add(core);
  const coreBlue = ellipse(zhihuBlue, 0.056, 0.056, 0.24);
  coreBlue.material.opacity = 1;
  root.add(coreBlue);
  return root;
}

function outlinedRoundedRect(width: number, height: number, radius: number, z: number, color = white): THREE.Group {
  const group = new THREE.Group();
  group.add(roundedRect(width + 0.08, height + 0.08, radius + 0.04, ink, z));
  group.add(roundedRect(width, height, radius, color, z + 0.02));
  return group;
}

function roundedRect(width: number, height: number, radius: number, color: number, z: number): THREE.Mesh {
  const x = width / 2;
  const y = height / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-x + radius, -y);
  shape.lineTo(x - radius, -y);
  shape.quadraticCurveTo(x, -y, x, -y + radius);
  shape.lineTo(x, y - radius);
  shape.quadraticCurveTo(x, y, x - radius, y);
  shape.lineTo(-x + radius, y);
  shape.quadraticCurveTo(-x, y, -x, y - radius);
  shape.lineTo(-x, -y + radius);
  shape.quadraticCurveTo(-x, -y, -x + radius, -y);
  return shapeMesh(shape, color, z);
}

function strokePath(points: Array<[number, number]>, radius: number, color: number, z: number): THREE.Group {
  const group = new THREE.Group();
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    if (!start || !end) continue;
    group.add(strokeSegment(new THREE.Vector2(start[0], start[1]), new THREE.Vector2(end[0], end[1]), radius, color, z));
  }
  return group;
}

function strokeSegment(start: THREE.Vector2, end: THREE.Vector2, radius: number, color: number, z: number): THREE.Group {
  const group = new THREE.Group();
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  const middle = roundedRect(radius * 2, length, radius, color, z);
  middle.position.set((start.x + end.x) / 2, (start.y + end.y) / 2, 0);
  middle.rotation.z = Math.atan2(dy, dx) - Math.PI / 2;
  const startCap = ellipse(color, radius, radius, z);
  startCap.position.set(start.x, start.y, 0);
  const endCap = ellipse(color, radius, radius, z);
  endCap.position.set(end.x, end.y, 0);
  group.add(middle, startCap, endCap);
  return group;
}

function ellipse(color: number, radiusX: number, radiusY: number, z: number): THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial> {
  const curve = new THREE.EllipseCurve(0, 0, radiusX, radiusY, 0, Math.PI * 2, false, 0);
  const shape = new THREE.Shape(curve.getPoints(64));
  return shapeMesh(shape, color, z);
}

function shapeMesh(shape: THREE.Shape, color: number, z: number, opacity = 1): THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial> {
  const mesh = new THREE.Mesh(
    new THREE.ShapeGeometry(shape),
    new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, side: THREE.DoubleSide }),
  );
  mesh.position.z = z;
  return mesh;
}

function slotAt(x: number, y: number, z: number): THREE.Group {
  const slot = new THREE.Group();
  slot.position.set(x, y, z);
  return slot;
}

function setOpacity(object: THREE.Object3D, opacity: number): void {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.material.transparent = true;
      child.material.opacity = opacity;
    }
  });
}

function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
      child.geometry.dispose();
      const material = child.material;
      if (Array.isArray(material)) material.forEach((item) => item.dispose());
      else material.dispose();
    }
  });
}
