/**
 * Claude Agent 封装：
 *   - 直接调用 Kimi API（Anthropic Messages API 兼容协议）
 *   - 支持流式 SSE 输出
 *   - 支持多轮对话（通过 messages 数组传递历史）
 *
 * 统一对外输出 UnifiedEvent 异步迭代器，方便上层做 SSE 或聚合。
 */
import { getConfig } from './config.js';
import {
  type UnifiedEvent,
  type SessionCreateOptions,
} from './types.js';

export interface RunAgentArgs {
  prompt: string;
  /** 历史消息（多轮对话） */
  history?: { role: 'user' | 'assistant'; content: string }[];
  /** 会话自定义配置 */
  options: SessionCreateOptions;
  /** 外部 abortController（取消） */
  abortController?: AbortController;
}

function buildSystemPrompt(opts: SessionCreateOptions): string | undefined {
  const parts: string[] = [];
  if (opts.systemPrompt) parts.push(opts.systemPrompt);
  if (opts.additionalSystem) parts.push(opts.additionalSystem);
  return parts.length ? parts.join('\n\n') : undefined;
}

// ------------------------------------------------------------------
// 直接调用 Kimi API（Anthropic Messages API 兼容协议）
// ------------------------------------------------------------------
async function* runWithDirectApi(args: RunAgentArgs): AsyncGenerator<UnifiedEvent> {
  const cfg = getConfig();
  const baseUrl = cfg.anthropicBaseUrl || 'https://api.kimi.com/coding';
  const apiUrl = `${baseUrl.replace(/\/+$/, '')}/v1/messages`;
  const model = args.options.model || cfg.claudeModel || 'kimi-for-coding';

  // 构建 messages 数组
  const messages: { role: string; content: string }[] = [];

  // 添加历史消息
  if (args.history && args.history.length > 0) {
    for (const h of args.history) {
      messages.push({ role: h.role, content: h.content });
    }
  }

  // 添加当前 prompt
  messages.push({ role: 'user', content: args.prompt });

  // 构建 system prompt
  const system = buildSystemPrompt(args.options);

  // 构建请求体
  const body: Record<string, unknown> = {
    model,
    messages,
    max_tokens: 4096,
    stream: true,
  };
  if (system) {
    body.system = system;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': cfg.anthropicApiKey,
    'anthropic-version': '2023-06-01',
  };

  yield { kind: 'status_change', state: 'running' };

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: args.abortController?.signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => 'unknown error');
      yield { kind: 'log', level: 'error', message: `API 请求失败 (${response.status}): ${errText}` };
      yield { kind: 'session_complete', result: '', subtype: 'error' };
      yield { kind: 'status_change', state: 'error' };
      return;
    }

    if (!response.body) {
      yield { kind: 'log', level: 'error', message: 'API 返回空响应体' };
      yield { kind: 'session_complete', result: '', subtype: 'error' };
      yield { kind: 'status_change', state: 'error' };
      return;
    }

    // 解析 SSE 流
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';
    let inputTokens = 0;
    let outputTokens = 0;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n');
      buffer = parts.pop() || '';

      for (const line of parts) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;

        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') continue;

        try {
          const event = JSON.parse(data);
          const eventType = event.type;

          if (eventType === 'content_block_delta' && event.delta?.type === 'text_delta') {
            const text = event.delta.text || '';
            if (text) {
              fullText += text;
              yield { kind: 'text_delta', text };
            }
          } else if (eventType === 'content_block_start' && event.content_block?.type === 'text') {
            const text = event.content_block.text || '';
            if (text) {
              fullText += text;
              yield { kind: 'text_delta', text };
            }
          } else if (eventType === 'message_start') {
            // 消息开始
          } else if (eventType === 'message_delta') {
            if (event.usage) {
              outputTokens = event.usage.output_tokens || 0;
            }
            if (event.delta?.stop_reason === 'end_turn') {
              // 结束
            }
          } else if (eventType === 'message_stop') {
            // 消息结束
          } else if (eventType === 'ping') {
            // keepalive
          }
        } catch {
          // 忽略解析失败的行
        }
      }
    }

    // 处理 buffer 中剩余的数据
    if (buffer.trim()) {
      const trimmed = buffer.trim();
      if (trimmed.startsWith('data:')) {
        const data = trimmed.slice(5).trim();
        if (data !== '[DONE]') {
          try {
            const event = JSON.parse(data);
            if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
              const text = event.delta.text || '';
              if (text) {
                fullText += text;
                yield { kind: 'text_delta', text };
              }
            }
          } catch {}
        }
      }
    }

    yield {
      kind: 'usage',
      inputTokens,
      outputTokens,
      model,
    };

    yield {
      kind: 'session_complete',
      result: fullText,
      subtype: 'success',
    };

    yield { kind: 'status_change', state: 'idle' };
  } catch (e: any) {
    if (e.name === 'AbortError') {
      yield { kind: 'log', level: 'info', message: '请求被取消' };
      yield { kind: 'session_complete', result: '', subtype: 'success' };
    } else {
      yield { kind: 'log', level: 'error', message: `API 调用失败: ${e.message}` };
      yield { kind: 'session_complete', result: '', subtype: 'error' };
    }
    yield { kind: 'status_change', state: 'error' };
  }
}

export async function* runAgent(args: RunAgentArgs): AsyncGenerator<UnifiedEvent> {
  yield* runWithDirectApi(args);
}

/**
 * 列出当前配置下可用的"工具命名空间"（给前端面板用）。
 */
export function listAvailableToolNamespaces(): {
  builtin: string[];
  mcp: { server: string; type: string }[];
} {
  const cfg = getConfig();
  return {
    builtin: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch', 'WebFetch'],
    mcp: Object.entries(cfg.mcp.mcpServers || {}).map(([name, s]) => ({
      server: name,
      type: (s as any).type || 'stdio',
    })),
  };
}
