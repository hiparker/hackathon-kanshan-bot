import { describe, expect, it } from 'vitest';
import {
  buildKanshanMarketDialogueCandidates,
  pickKanshanMarketDialogueCandidate,
  chooseKanshanMarketReactionAction,
  formatKanshanMarketDialogue,
  type KanshanMarketSnapshot,
} from '../kanshanMarketStream';

describe('kanshanMarketStream', () => {
  it('builds broadcast candidates from weather, quotes, and news titles', () => {
    const snapshot: KanshanMarketSnapshot = {
      generated_at: 1,
      summary: 'fallback summary',
      weather: {
        city: 'Beijing',
        condition: 'Sunny',
        temp_c: 29,
        feels_like_c: 27,
        humidity: 48,
      },
      quotes: [
        { key: 'gold', label: '黄金价格', price: 4706.4, unit: 'USD' },
        { key: 'btc', label: 'BTC价格', price: 81255.33, unit: 'USD' },
        { key: 'eth', label: 'ETH价格', price: 2311.35, unit: 'USD' },
        { key: 'shanghai', label: '上证指数', price: 4205.83, unit: 'points' },
        { key: 'shenzhen', label: '深证成指', price: 15785.13, unit: 'points' },
        { key: 'nasdaq', label: 'NASDAQ Composite', price: 22484.07, unit: 'points' },
        { key: 'hang_seng', label: 'HANG SENG INDEX', price: 26394.77, unit: 'points' },
      ],
      news: [
        { source: 'tenxunwang', category: 'dailynews', title: '头条一' },
        { source: 'eastmoney', category: '7*24小时全球直播', title: '头条二' },
      ],
    };

    expect(buildKanshanMarketDialogueCandidates(snapshot)).toEqual([
      { text: '天气 Beijing  Sunny  29C' },
      { text: '黄金 4706.40' },
      { text: 'BTC 81255.33' },
      { text: 'ETH 2311.35' },
      { text: '上证 4205.83' },
      { text: '深证 15785.13' },
      { text: 'NASDAQ 22484.07' },
      { text: '恒生 26394.77' },
      { text: '新闻：头条一' },
      { text: '新闻：头条二' },
    ]);
  });

  it('randomly picks one candidate to broadcast', () => {
    const snapshot: KanshanMarketSnapshot = {
      generated_at: 1,
      summary: 'fallback summary',
      weather: {
        city: 'Beijing',
        condition: 'Sunny',
        temp_c: 29,
        feels_like_c: 27,
        humidity: 48,
      },
      quotes: [
        { key: 'gold', label: '黄金价格', price: 4706.4, unit: 'USD' },
        { key: 'btc', label: 'BTC价格', price: 81255.33, unit: 'USD' },
      ],
      news: [
        { source: 'tenxunwang', category: 'dailynews', title: '头条一' },
      ],
    };

    expect(formatKanshanMarketDialogue(snapshot, 0.0)).toBe('看山播报：天气 BeijingSunny29C');
    expect(formatKanshanMarketDialogue(snapshot, 0.51)).toBe('看山播报：BTC 81255.33');
    expect(formatKanshanMarketDialogue(snapshot, 0.99)).toBe('看山播报：新闻：头条一');
  });

  it('keeps url when the chosen candidate is a news item', () => {
    const snapshot: KanshanMarketSnapshot = {
      generated_at: 1,
      summary: '',
      quotes: [],
      news: [
        { source: 'tenxunwang', category: 'dailynews', title: '头条一', url: 'https://example.com/news-1' },
      ],
    };

    expect(pickKanshanMarketDialogueCandidate(snapshot, 0.3)).toEqual({
      text: '新闻：头条一',
      url: 'https://example.com/news-1',
    });
  });

  it('falls back to backend summary when structured fields are missing', () => {
    expect(formatKanshanMarketDialogue({
      generated_at: 1,
      summary: 'only summary',
      quotes: [],
    })).toBe('看山播报：only summary');
  });

  it('chooses a stronger action for large quote swings', () => {
    expect(chooseKanshanMarketReactionAction({
      generated_at: 1,
      summary: '',
      quotes: [{ key: 'btc', label: 'BTC价格', price: 1, change_percent: 2.1 }],
    })).toBe('run');

    expect(chooseKanshanMarketReactionAction({
      generated_at: 1,
      summary: '',
      quotes: [{ key: 'btc', label: 'BTC价格', price: 1, change_percent: 0.2 }],
      news: [{ source: 'x', category: 'y', title: 'z' }],
    })).toBe('happy');
  });
});
