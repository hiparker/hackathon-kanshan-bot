import type { DistillCorpusItem } from './distillSelfCorpus';

export interface TopicCluster {
  topic: string;
  count: number;
  /** 该话题下代表性摘要（取首条 excerpt + 字数提示） */
  summary: string;
}

export interface DistillProfile {
  topicClusters: TopicCluster[];
  /** 从文本里归纳的表达习惯（启发式） */
  styleHints: string[];
  /** 粗略的价值倾向描述 */
  valueTendency: string;
  avgAnswerLength: number;
  /** 逻辑结构关键词命中统计 */
  frameworkHints: string[];
}

const STRUCT_MARKERS = ['首先', '其次', '最后', '综上', '结论', '背景', '下一步', '三段', '复盘', '评测', '分布'];

const VALUE_HINTS: Array<{ keys: string[]; label: string }> = [
  { keys: ['数据', '验证', '评测', '指标'], label: '偏实证与可验证' },
  { keys: ['协作', '成本', '复盘', '里程碑'], label: '偏工程化协作' },
  { keys: ['习惯', '长期', '追问'], label: '偏长期主义与自省' },
];

function averageLength(items: DistillCorpusItem[]): number {
  if (items.length === 0) return 0;
  const sum = items.reduce((acc, it) => acc + it.body.length, 0);
  return Math.round(sum / items.length);
}

function collectStyleHints(text: string): string[] {
  const hints: string[] = [];
  if (/三段|背景|判断|下一步/.test(text)) hints.push('常用「背景—判断—下一步」式展开');
  if (/复盘|里程碑|笔记/.test(text)) hints.push('强调可复盘与过程留痕');
  if (/检索|RAG|切块|引用/.test(text)) hints.push('技术话题偏好落地路径与边界条件');
  if (/追问|反例|行动/.test(text)) hints.push('输出习惯带追问与反例');
  return hints.slice(0, 5);
}

function inferValueTendency(items: DistillCorpusItem[]): string {
  const blob = items.map((it) => it.body).join('\n');
  const scores = VALUE_HINTS.map((row) => ({
    label: row.label,
    score: row.keys.filter((k) => blob.includes(k)).length,
  }));
  scores.sort((a, b) => b.score - a.score);
  const top = scores.filter((s) => s.score > 0);
  if (top.length === 0) return '稳健、偏理性论述';
  return top.map((t) => t.label).join('；');
}

function frameworkHits(items: DistillCorpusItem[]): string[] {
  const blob = items.map((it) => it.body).join('\n');
  const hits = STRUCT_MARKERS.filter((m) => blob.includes(m));
  return Array.from(new Set(hits)).slice(0, 6);
}

/**
 * 文档中的「逻辑抽取」演示版：按话题聚类 + 粗粒度风格/价值/结构信号。
 * 真蒸馏需在服务端用嵌入与微调；此处为可交互 Demo。
 */
export function extractDistillProfile(items: DistillCorpusItem[]): DistillProfile {
  const byTopic = new Map<string, DistillCorpusItem[]>();
  for (const it of items) {
    const list = byTopic.get(it.topic) ?? [];
    list.push(it);
    byTopic.set(it.topic, list);
  }

  const topicClusters: TopicCluster[] = Array.from(byTopic.entries()).map(([topic, group]) => {
    const summary = `${group[0]?.excerpt ?? ''}（共 ${group.length} 篇）`.slice(0, 120);
    return { topic, count: group.length, summary };
  });

  const allText = items.map((it) => it.body).join('\n');
  const styleHints = collectStyleHints(allText);
  const valueTendency = inferValueTendency(items);
  const avgAnswerLength = averageLength(items);
  const frameworkHints = frameworkHits(items);

  return {
    topicClusters,
    styleHints,
    valueTendency,
    avgAnswerLength,
    frameworkHints,
  };
}

function tokenizeForScore(q: string): string[] {
  const cleaned = q.replace(/\s+/g, '');
  const set = new Set<string>();
  for (let i = 0; i < cleaned.length; i++) {
    set.add(cleaned[i] ?? '');
    if (i < cleaned.length - 1) {
      set.add(cleaned.slice(i, i + 2));
    }
  }
  return Array.from(set).filter((t) => t.length > 0);
}

export interface DistillSnippet {
  title: string;
  text: string;
  score: number;
}

/**
 * 轻量「素材检索」：按字与二字片段重合度打分，模拟蒸馏前的召回。
 */
export function pickRelevantSnippets(
  question: string,
  items: DistillCorpusItem[],
  maxSnippets: number,
  maxCharsPerSnippet: number,
): DistillSnippet[] {
  const tokens = tokenizeForScore(question);
  if (tokens.length === 0) {
    return items.slice(0, maxSnippets).map((it) => ({
      title: it.title,
      text: it.excerpt.slice(0, maxCharsPerSnippet),
      score: 0,
    }));
  }

  const scored = items.map((it) => {
    const blob = `${it.topic}\n${it.title}\n${it.body}`;
    let score = 0;
    for (const t of tokens) {
      if (t.length >= 2 && blob.includes(t)) score += 2;
      else if (t.length === 1 && blob.includes(t)) score += 0.2;
    }
    return { item: it, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxSnippets).map((row) => ({
    title: row.item.title,
    text: row.item.body.slice(0, maxCharsPerSnippet),
    score: row.score,
  }));
}

export function profileToBrief(profile: DistillProfile): string {
  const topics = profile.topicClusters.map((c) => `${c.topic}×${c.count}`).join('、');
  const frameworks = profile.frameworkHints.length ? profile.frameworkHints.join('、') : '（无明显结构词）';
  return `话题分布：${topics}。价值倾向：${profile.valueTendency}。常用结构信号：${frameworks}。平均篇幅约 ${profile.avgAnswerLength} 字。`;
}
