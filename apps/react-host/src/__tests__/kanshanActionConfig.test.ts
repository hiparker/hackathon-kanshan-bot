import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  chooseKanshanClip,
  getKanshanActionClipName,
  kanshanActionConfig,
  kanshanClipDialogueConfig,
  kanshanClipCorrectionConfig,
  resolveKanshanClipName,
  type KanshanActionConfigItem,
} from '../kanshanActionConfig';
import { kanshanModelConfig } from '../kanshanModelConfig';

interface GlbJsonChunk {
  animations?: Array<{ name?: string }>;
}

const here = fileURLToPath(new URL('.', import.meta.url));
const glbPath = resolve(here, '../../../../assets/model', kanshanModelConfig.fileName);

describe('kanshan action config', () => {
  it('maps every semantic clip to an exact GLB animation name after correction', () => {
    const animationNames = readGlbAnimationNames(glbPath);
    const animationNameSet = new Set(animationNames);
    const semanticClipNames = kanshanActionConfig.flatMap((item) => item.clips.map((clip) => getKanshanActionClipName(clip)));
    const resolvedRawClipNames = semanticClipNames.map((clipName) => resolveKanshanClipName(clipName));

    expect(semanticClipNames.length).toBeGreaterThan(0);
    expect(resolvedRawClipNames.filter((clipName) => !animationNameSet.has(clipName))).toEqual([]);
  });

  it('keeps every correction target backed by an exact GLB animation name', () => {
    const animationNames = readGlbAnimationNames(glbPath);
    const animationNameSet = new Set(animationNames);
    const correctedRawClipNames = kanshanClipCorrectionConfig.map((item) => item.rawClipName);

    expect(correctedRawClipNames.filter((clipName) => !animationNameSet.has(clipName))).toEqual([]);
  });

  it('keeps every semantic clip backed by dialogue lines', () => {
    const semanticClipNames = new Set(kanshanClipCorrectionConfig.map((item) => item.semanticClipName));
    const dialogueNames = new Set(kanshanClipDialogueConfig.map((item) => item.semanticClipName));

    expect([...semanticClipNames].filter((clipName) => !dialogueNames.has(clipName))).toEqual([]);
    expect(kanshanClipDialogueConfig.filter((item) => item.lines.length === 0)).toEqual([]);
  });

  it('does not expose visible semantic actions without clips', () => {
    const visibleActions: readonly KanshanActionConfigItem[] = kanshanActionConfig;
    expect(visibleActions.filter((item) => item.visible && item.clips.length === 0)).toEqual([]);
  });

  it('selects multi-clip actions with injectable randomness', () => {
    const clips: readonly string[] = ['Idle', 'Happy_Sway_Standing', 'Thoughtful_Walk'];
    expect(chooseKanshanClip(clips, () => 0)).toBe('Idle');
    expect(chooseKanshanClip(clips, () => 0.4)).toBe('Happy_Sway_Standing');
    expect(chooseKanshanClip(clips, () => 0.99)).toBe('Thoughtful_Walk');
  });

  it('selects weighted clips by configured ratio', () => {
    const clips = [
      { clip: 'Idle', weight: 3 },
      { clip: 'Happy_Sway_Standing', weight: 1 },
      { clip: 'Thoughtful_Walk', weight: 0 },
    ];

    expect(chooseKanshanClip(clips, () => 0)).toBe('Idle');
    expect(chooseKanshanClip(clips, () => 0.74)).toBe('Idle');
    expect(chooseKanshanClip(clips, () => 0.75)).toBe('Happy_Sway_Standing');
    expect(chooseKanshanClip(clips, () => 0.99)).toBe('Happy_Sway_Standing');
  });

  it('keeps terminal and next-action semantics explicit', () => {
    const actionByName = Object.fromEntries(kanshanActionConfig.map((item) => [item.action, item])) as Partial<Record<string, KanshanActionConfigItem>>;

    expect(actionByName['death-notice']?.nextAction).toBeUndefined();
    expect(actionByName.revive?.nextAction).toBe('run');
    expect(actionByName.dead?.terminal).toBe(true);
    expect(actionByName.dead?.clips.map((clip) => getKanshanActionClipName(clip))).toEqual(['Sleep_Normally']);
  });
});

function readGlbAnimationNames(filePath: string): string[] {
  if (!existsSync(filePath)) {
    throw new Error(
      `GLB asset missing: ${filePath}. Run "pnpm assets:fetch" to download it from the CDN listed in assets/model/manifest.json.`,
    );
  }

  const buffer = readFileSync(filePath);
  let offset = 12;

  while (offset < buffer.length) {
    const chunkLength = buffer.readUInt32LE(offset);
    const chunkType = buffer.toString('utf8', offset + 4, offset + 8);
    const chunk = buffer.slice(offset + 8, offset + 8 + chunkLength);
    if (chunkType === 'JSON') {
      const json = JSON.parse(chunk.toString('utf8').trim()) as GlbJsonChunk;
      return json.animations?.map((animation) => animation.name).filter((name): name is string => Boolean(name)) ?? [];
    }
    offset += 8 + chunkLength;
  }

  return [];
}
