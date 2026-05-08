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

type EffectId = 'heart' | 'sweat' | 'music-note';
type SlotMap = Record<PetSlot, THREE.Group>;
type KanshanMaterialMode = 'pbr' | 'texture' | 'toon-bw';

const ink = 0x17202a;
const white = 0xffffff;
const boardBrown = 0x8a6a44;
const heartRed = 0xe94560;
const sweatBlue = 0x62b6dd;

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
        this.currentAction = command.action;
        this.emit({ type: 'actionStart', action: command.action });
        this.playActionClip(command.action, command.loop ?? false, command.repetitions);
        if (!this.mixer && !command.loop) this.emit({ type: 'actionEnd', action: command.action });
        break;
      case 'playClip':
        this.playRawClip(command.clipName, command.loop ?? false, command.repetitions);
        break;
      case 'setMood':
        this.currentAction = command.mood === 'normal' ? 'idle' : command.mood;
        this.emit({ type: 'actionStart', action: this.currentAction });
        this.playActionClip(this.currentAction, true);
        break;
      case 'equipProp':
        this.equipProp(command.slot, command.propId);
        this.emit({ type: 'propEquipped', slot: command.slot, propId: command.propId });
        break;
      case 'showEffect':
        this.showEffect(command.effectId, command.slot ?? 'emotion', command.durationMs ?? 1200);
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
      undefined,
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

  private showEffect(effectId: string, slot: PetSlot, durationMs: number): void {
    if (this.effect) {
      this.effect.parent?.remove(this.effect);
      disposeObject(this.effect);
      this.effect = null;
    }
    const effect = createEffect(effectId as EffectId);
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
    this.applyEffect(elapsed);
    this.renderer.render(this.scene, this.camera);
    this.frameId = window.requestAnimationFrame(this.animate);
  };

  private applyModelMotion(elapsed: number): void {
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

  private applyEffect(elapsed: number): void {
    if (!this.effect) return;
    const progress = (elapsed - this.effectStartedAt) / this.effectDuration;
    if (progress >= 1) {
      this.effect.parent?.remove(this.effect);
      disposeObject(this.effect);
      this.effect = null;
      return;
    }
    this.effect.position.y = progress * 0.55;
    this.effect.scale.setScalar(1 + progress * 0.18);
    setOpacity(this.effect, 1 - progress);
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
  return createMusicNote();
}

function createHeart(): THREE.Group {
  const heart = new THREE.Group();
  heart.add(ellipse(heartRed, 0.08, 0.08, 0.2));
  const right = ellipse(heartRed, 0.08, 0.08, 0.2);
  right.position.x = 0.1;
  const left = ellipse(heartRed, 0.08, 0.08, 0.2);
  left.position.x = -0.1;
  const tip = new THREE.Shape();
  tip.moveTo(-0.18, 0.0);
  tip.quadraticCurveTo(0, -0.24, 0.18, 0.0);
  tip.lineTo(0, -0.22);
  tip.lineTo(-0.18, 0.0);
  heart.add(left, right, shapeMesh(tip, heartRed, 0.2));
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
