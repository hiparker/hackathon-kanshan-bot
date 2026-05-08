import type { PetAction } from '@kanshan/bridge';

export type KanshanActionDuration = 'long' | 'temporary' | 'terminal';
export type KanshanActionClipConfig = string | { clip: string; weight?: number };

export interface KanshanActionConfigItem {
  action: PetAction;
  label: string;
  duration: KanshanActionDuration;
  clips: readonly KanshanActionClipConfig[];
  loop: boolean;
  visible: boolean;
  terminal?: boolean;
  onlyWhenDead?: boolean;
  nextAction?: PetAction;
  repetitions?: number;
}

export interface KanshanClipCorrectionItem {
  semanticClipName: string;
  rawClipName: string;
  note?: string;
}

export interface KanshanRawClipConfigItem {
  clipName: string;
  label: string;
  note?: string;
}

export interface KanshanClipDialogueItem {
  semanticClipName: string;
  lines: readonly string[];
}

export const kanshanActionConfig = [
  {
    action: 'idle',
    label: '基础',
    duration: 'long',
    clips: [
      { clip: 'Happy_Sway_Standing', weight: 3 },
      { clip: 'Thoughtful_Walk', weight: 3 },
      { clip: 'walking_2_inplace', weight: 3 },
      { clip: 'Wave_for_Help_2', weight: 2 }
    ],
    loop: true,
    visible: true,
  },
  {
    action: 'run',
    label: '运动',
    duration: 'temporary',
    clips: ['Running', 'push_up', 'situps'],
    loop: false,
    visible: false,
    repetitions: 5,
  },
  {
    action: 'hungry',
    label: '饥饿',
    duration: 'long',
    clips: ['Sit_Cross_Legged_on_Floor'],
    loop: true,
    visible: true,
  },
  {
    action: 'sleepy',
    label: '犯困',
    duration: 'long',
    clips: ['Dozing_Elderly'],
    loop: true,
    visible: true,
  },
  {
    action: 'sick',
    label: '生病',
    duration: 'long',
    clips: ['circle_crunch'],
    loop: true,
    visible: true,
  },
  {
    action: 'dead',
    label: '彻底死亡',
    duration: 'terminal',
    clips: ['Sleep_Normally'],
    loop: true,
    visible: true,
    terminal: true,
  },
  {
    action: 'happy',
    label: '高兴',
    duration: 'temporary',
    clips: ['Breakdance_1990', 'Gangnam_Groove', 'Hip_Hop_Dance', 'penguin_walk', 'Indoor_Play'],
    loop: false,
    visible: true,
    repetitions: 2,
  },
  {
    action: 'revive',
    label: '复活',
    duration: 'temporary',
    clips: ['Running'],
    loop: false,
    visible: true,
    onlyWhenDead: true,
    nextAction: 'run',
  },
  {
    action: 'death-notice',
    label: '死亡通知',
    duration: 'temporary',
    clips: ['Strangled_and_Fall_Forward'],
    loop: false,
    visible: true,
    terminal: true,
  },
] as const satisfies readonly KanshanActionConfigItem[];

export const kanshanClipCorrectionConfig: readonly KanshanClipCorrectionItem[] = [
  { rawClipName: 'Breakdance_1990', semanticClipName: 'Wave_for_Help_2' },
  { rawClipName: 'Dozing_Elderly', semanticClipName: 'Breakdance_1990' },
  { rawClipName: 'Gangnam_Groove', semanticClipName: 'Hip_Hop_Dance' },
  { rawClipName: 'Happy_Sway_Standing', semanticClipName: 'Strangled_and_Fall_Forward' },
  { rawClipName: 'Hip_Hop_Dance', semanticClipName: 'Walking' },
  { rawClipName: 'Idle', semanticClipName: 'push_up', note: 'v5 原始 clip，暂未接入语义动作。' },
  { rawClipName: 'Indoor_Play', semanticClipName: 'Gangnam_Groove' },
  { rawClipName: 'Running', semanticClipName: 'Happy_Sway_Standing' },
  { rawClipName: 'Sit_Cross_Legged_on_Floor', semanticClipName: 'Idle' },
  { rawClipName: 'Sleep_Normally', semanticClipName: 'Dozing_Elderly' },
  { rawClipName: 'Strangled_and_Fall_Forward', semanticClipName: 'Running' },
  { rawClipName: 'Thoughtful_Walk', semanticClipName: 'Sleep_Normally' },
  { rawClipName: 'Walking', semanticClipName: 'Thoughtful_Walk', note: 'v5 原始 clip，暂未接入语义动作。' },
  { rawClipName: 'Wave_for_Help_2', semanticClipName: 'circle_crunch', note: 'v5 原始 clip，暂未接入语义动作。' },
  { rawClipName: 'circle_crunch', semanticClipName: 'penguin_walk' },
  { rawClipName: 'penguin_walk', semanticClipName: 'situps' },
  { rawClipName: 'push_up', semanticClipName: 'walking_2_inplace' },
  { rawClipName: 'situps', semanticClipName: 'Indoor_Play' },
  { rawClipName: 'walking_2_inplace', semanticClipName: 'Sit_Cross_Legged_on_Floor' },
];

export const kanshanRawClipConfig: readonly KanshanRawClipConfigItem[] = kanshanClipCorrectionConfig.map((item) => ({
  clipName: item.rawClipName,
  label: item.semanticClipName,
  note: item.note,
}));

export const kanshanClipDialogueConfig: readonly KanshanClipDialogueItem[] = [
  {
    semanticClipName: 'Breakdance_1990',
    lines: [
      '地心引力暂时下班，看山的尾巴开始接管舞池秩序 ZHI——',
      '这套动作像 1990 年的风吹到北极，连小鱼干都想转两圈 ZHI——',
      '四肢看似冷静，脑内已经完成一篇《霹雳舞与冰面摩擦力》论文 ZHI——',
    ],
  },
  {
    semanticClipName: 'Dozing_Elderly',
    lines: [
      '眼皮正在开会，结论是先眯 3 秒再讨论宇宙 ZHI——',
      '打工狐的午后哲学：身体待机，灵魂去北极续了一杯冰 ZHI——',
      '看起来在打瞌睡，其实是在和梦里的鳕鱼进行学术交流 ZHI——',
    ],
  },
  {
    semanticClipName: 'Gangnam_Groove',
    lines: [
      '这不是舞步，是看山对节奏做出的严谨实验 ZHI——',
      '腿已经动起来了，表情还在坚持市场部的职业稳定 ZHI——',
      '江南风吹进北极，冰面立刻出现一只低调但很会卡点的狐 ZHI——',
    ],
  },
  {
    semanticClipName: 'Happy_Sway_Standing',
    lines: [
      '开心不用说太多，左右摇一摇就能把小鱼干库存摇满 ZHI——',
      '站着也能快乐，说明自由不一定需要很大的场地 ZHI——',
      '表情没有明显变化，但尾巴附近的空气已经开始庆祝 ZHI——',
    ],
  },
  {
    semanticClipName: 'Hip_Hop_Dance',
    lines: [
      '节拍一响，看山的四肢开始拒绝平庸 ZHI——',
      '嘻哈是自由的，短尾巴也是自由的，工牌暂时旁观 ZHI——',
      '看似随便动动，其实每一步都在挑战办公室地板的承受力 ZHI——',
    ],
  },
  {
    semanticClipName: 'Idle',
    lines: [
      '刚刚被摸了一下，表情看似稳定，脑内已经启动「人类接触行为研究」ZHI——',
      '摸毛事件已记录，看山外表无波动，内心正在计算信任半径 ZHI——',
      '被碰到的那一小块绒毛，正在低调宣布今天被世界注意到 ZHI——',
    ],
  },
  {
    semanticClipName: 'Indoor_Play',
    lines: [
      '室内空间有限，想象力没有封顶，看山开始低成本快乐 ZHI——',
      '不出门也能玩，秘密基地的含金量突然升高 ZHI——',
      '地板、空气和小玩具都已就位，狐的快乐系统启动 ZHI——',
    ],
  },
  {
    semanticClipName: 'Running',
    lines: [
      '小短腿开始加速，目标不是终点，是路上的新鲜空气 ZHI——',
      '跑起来以后，北京的风也得给看山让个小道 ZHI——',
      '速度不一定很快，但每一步都很认真地逃离久坐 ZHI——',
    ],
  },
  {
    semanticClipName: 'Sit_Cross_Legged_on_Floor',
    lines: [
      '盘腿坐好不是在冥想，是肚子正在严肃提案：小鱼干可以安排 ZHI——',
      '胃部已发来空罐头回声，看山正在安静等待投喂程序启动 ZHI——',
      '坐得这么端正，主要是想让小鱼干和罐头看见这份诚意 ZHI——',
    ],
  },
  {
    semanticClipName: 'Sleep_Normally',
    lines: [
      '生命值归零中，复活羽毛如果在背包里，请让它立刻上班 ZHI——',
      '已进入安静躺平模式，急需一根复活羽毛把看山从梦里捞回 ZHI——',
      '小鱼干还没吃完，复活羽毛请尽快登场，逻辑上不能就此结束 ZHI——',
    ],
  },
  {
    semanticClipName: 'Strangled_and_Fall_Forward',
    lines: [
      '体力即将见底，身体先向前倒下，脑子还在申请紧急重启 ZHI——',
      '前扑警报触发，看山正在用最后力气提醒：情况需要处理 ZHI——',
      '重心失守，生命值闪红，复活羽毛可以提前从背包里探头了 ZHI——',
    ],
  },
  {
    semanticClipName: 'Thoughtful_Walk',
    lines: [
      '边走边想，看山正在给一个小问题盖 12 层逻辑楼 ZHI——',
      '步子很慢，脑子很忙，可能已经绕过半个宇宙 ZHI——',
      '看似散步，其实是在对世界做一次低噪音观察 ZHI——',
    ],
  },
  {
    semanticClipName: 'Walking',
    lines: [
      '普通走路，也能走出一种「今天先看看世界怎么运行」的气质 ZHI——',
      '4.733 秒刚好够一只狐路过现实，顺手捡起一个灵感 ZHI——',
      '步伐稳定，工牌在线，看山开始执行今日观察任务 ZHI——',
    ],
  },
  {
    semanticClipName: 'Wave_for_Help_2',
    lines: [
      '小爪挥起来，不是慌张，是请求世界派一条小鱼干支援 ZHI——',
      '远处的朋友请注意，这里有一只短尾巴狐需要被看见 ZHI——',
      '挥手信号已发出，愿懂狐语的人类迅速抵达现场 ZHI——',
    ],
  },
  {
    semanticClipName: 'circle_crunch',
    lines: [
      '身体卷成一团，像感冒把看山的系统临时降频了，想要关心和感冒药 ZHI——',
      '鼻头不太精神，核心也不想营业，需要一点照顾和按说明吃药 ZHI——',
      '生病时的狐会自动缩小活动范围，关心、热水和感冒药都很重要 ZHI——',
    ],
  },
  {
    semanticClipName: 'penguin_walk',
    lines: [
      '企鹅步一出，北极朋友圈的跨物种友谊就有画面了 ZHI——',
      '摇摇摆摆也能前进，说明路线不直也可以抵达快乐 ZHI——',
      '这步伐很北极，很克制，也很适合偷偷靠近小鱼干 ZHI——',
    ],
  },
  {
    semanticClipName: 'push_up',
    lines: [
      '俯卧撑开始，地板和看山正在互相确认实力 ZHI——',
      '每撑起一次，都是对久坐打工生活的温和反击 ZHI——',
      '小爪撑地，表情平静，肌肉在后台偷偷提交进度 ZHI——',
    ],
  },
  {
    semanticClipName: 'situps',
    lines: [
      '仰卧起坐像人生重启键，躺下再起来，继续营业 ZHI——',
      '起身那一刻，看山和腹肌达成了临时合作协议 ZHI——',
      '看山正在用核心力量证明，小鱼干也需要被认真消耗 ZHI——',
    ],
  },
  {
    semanticClipName: 'walking_2_inplace',
    lines: [
      '原地走路很适合思考，身体没远行，脑子已经到北冰洋 ZHI——',
      '看似没移动，其实在给灵感做热身，路线全在脑内 ZHI——',
      '原地踏步也有意义，至少小短腿正在认真模拟远方 ZHI——',
    ],
  },
];

export const kanshanClipAliasMap = Object.fromEntries(
  kanshanClipCorrectionConfig.map((item) => [item.semanticClipName, item.rawClipName]),
) as Record<string, string>;

export const kanshanRawClipSemanticNameMap = Object.fromEntries(
  kanshanClipCorrectionConfig.map((item) => [item.rawClipName, item.semanticClipName]),
) as Record<string, string>;

export const kanshanClipDialogueMap = Object.fromEntries(
  kanshanClipDialogueConfig.map((item) => [item.semanticClipName, item.lines]),
) as Record<string, readonly string[]>;

export const kanshanSemanticClipNames = Array.from(new Set(kanshanActionConfig.flatMap((item) => item.clips.map((clip) => getKanshanActionClipName(clip)))));

export function resolveKanshanClipName(semanticClipName: string): string {
  return kanshanClipAliasMap[semanticClipName] ?? semanticClipName;
}

export function getKanshanActionClipName(clip: KanshanActionClipConfig): string {
  return typeof clip === 'string' ? clip : clip.clip;
}

export function getKanshanActionClipWeight(clip: KanshanActionClipConfig): number {
  if (typeof clip === 'string') return 1;
  return Number.isFinite(clip.weight) && clip.weight !== undefined && clip.weight > 0 ? clip.weight : 0;
}

export function formatKanshanActionClip(clip: KanshanActionClipConfig): string {
  const clipName = getKanshanActionClipName(clip);
  const weight = getKanshanActionClipWeight(clip);

  return weight === 1 ? clipName : `${clipName}(${weight})`;
}

export function resolveKanshanClipDialogue(semanticClipName: string, random: () => number = Math.random): string | undefined {
  const lines = kanshanClipDialogueMap[semanticClipName];
  if (!lines || lines.length === 0) return undefined;

  return lines[Math.min(Math.floor(random() * lines.length), lines.length - 1)];
}

export function resolveKanshanClipNames(semanticClipNames: readonly KanshanActionClipConfig[]) {
  return semanticClipNames.map((clip) => ({
    clipName: resolveKanshanClipName(getKanshanActionClipName(clip)),
    weight: getKanshanActionClipWeight(clip),
  }));
}

export const kanshanClipMap = Object.fromEntries(
  kanshanActionConfig.map((item) => [item.action, resolveKanshanClipNames(item.clips)]),
) as Partial<Record<PetAction, ReturnType<typeof resolveKanshanClipNames>>>;

export const kanshanActionMeta = Object.fromEntries(
  kanshanActionConfig.map((item) => [item.action, item]),
) as Partial<Record<PetAction, KanshanActionConfigItem>>;

export const visibleKanshanActions = kanshanActionConfig.filter((item) => item.visible);

const previewableKanshanActions = kanshanActionConfig.filter((item) => item.visible || item.action === 'run');

export const previewActionGroups: readonly { title: string; actions: readonly KanshanActionConfigItem[] }[] = [
  {
    title: '长期动作',
    actions: previewableKanshanActions.filter((item) => item.duration === 'long' || item.duration === 'terminal'),
  },
  {
    title: '临时动作',
    actions: previewableKanshanActions.filter((item) => item.duration === 'temporary'),
  },
] as const;

export function chooseKanshanClip(
  clips: readonly KanshanActionClipConfig[],
  random: () => number = Math.random,
): string | undefined {
  if (clips.length === 0) return undefined;
  const weightedClips = clips.map((clip) => ({ clipName: getKanshanActionClipName(clip), weight: getKanshanActionClipWeight(clip) }));
  const totalWeight = weightedClips.reduce((sum, clip) => sum + clip.weight, 0);
  if (totalWeight <= 0) return undefined;

  let cursor = random() * totalWeight;
  for (const clip of weightedClips) {
    cursor -= clip.weight;
    if (cursor < 0) return clip.clipName;
  }

  return weightedClips[weightedClips.length - 1]?.clipName;
}
