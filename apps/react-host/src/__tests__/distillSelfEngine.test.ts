import { describe, expect, it } from 'vitest';
import { MOCK_DISTILL_CORPUS } from '../distillSelfCorpus';
import { extractDistillProfile, pickRelevantSnippets, profileToBrief } from '../distillSelfEngine';

describe('distillSelfEngine', () => {
  it('extracts topic clusters and profile fields from corpus', () => {
    const profile = extractDistillProfile(MOCK_DISTILL_CORPUS);
    expect(profile.topicClusters.length).toBeGreaterThan(0);
    expect(profile.avgAnswerLength).toBeGreaterThan(20);
    expect(profile.valueTendency.length).toBeGreaterThan(0);
    const brief = profileToBrief(profile);
    expect(brief).toContain('话题分布');
    expect(brief).toContain('价值倾向');
  });

  it('ranks snippets by keyword overlap with question', () => {
    const q = '大模型 RAG 检索怎么做';
    const snippets = pickRelevantSnippets(q, MOCK_DISTILL_CORPUS, 3, 200);
    expect(snippets.length).toBeGreaterThan(0);
    expect(snippets[0]?.title.length).toBeGreaterThan(0);
    const titles = snippets.map((s) => s.title).join(' ');
    expect(/RAG|模型|检索|微调/.test(titles)).toBe(true);
  });
});
