/**
 * Hono 路由：
 *   GET  /health
 *   GET  /tools                          工具命名空间
 *   POST /config/reload                  重载 mcp.json
 *
 *   POST /sessions                       创建会话
 *   GET  /sessions                       列出（?userId=）
 *   GET  /sessions/:id
 *   GET  /sessions/:id/messages          读历史 JSONL
 *   DELETE /sessions/:id
 *   POST /sessions/:id/abort             取消运行
 *   POST /sessions/:id/messages          发送消息（?stream=1 → SSE）
 *   POST /chat                           一次性对话（自动建/续 session）
 *
 * SSE 事件名参考根目录 src/server/sse.ts 的 chat:* 命名，并带优先级元信息。
 */
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';

import { runAgent, listAvailableToolNamespaces } from './agent.js';
import { getConfig, reloadConfig } from './config.js';
import * as store from './sessions.js';
import {
  type UnifiedEvent,
  type SendMessageRequest,
  type SessionCreateOptions,
  type SseEventPriority,
} from './types.js';

export const app = new Hono();

// ---------- 鉴权中间件 ----------
app.use('*', async (c, next) => {
  const token = getConfig().sidecarToken;
  if (!token) return next();
  const header = c.req.header('x-sidecar-token') || c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
  if (header === token) return next();
  return c.json({ error: 'UNAUTHORIZED' }, 401);
});

// ---------- 元信息 ----------
app.get('/health', (c) => {
  const cfg = getConfig();
  return c.json({
    ok: true,
    runtime: cfg.runtime,
    model: cfg.claudeModel,
    hasApiKey: Boolean(cfg.anthropicApiKey),
    mcpServers: Object.keys(cfg.mcp.mcpServers),
    sessions: store.stats(),
  });
});

app.get('/tools', (c) => c.json(listAvailableToolNamespaces()));

app.post('/config/reload', (c) => {
  const cfg = reloadConfig();
  return c.json({ ok: true, mcpServers: Object.keys(cfg.mcp.mcpServers) });
});

// ---------- 会话 CRUD ----------
app.post('/sessions', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as SessionCreateOptions;
  const meta = store.createSession(body || {});
  return c.json(meta, 201);
});

app.get('/sessions', (c) => {
  const userId = c.req.query('userId') || undefined;
  return c.json({ sessions: store.listSessions(userId) });
});

app.get('/sessions/:id', (c) => {
  const s = store.getSession(c.req.param('id'));
  if (!s) return c.json({ error: 'NOT_FOUND' }, 404);
  return c.json(s);
});

app.get('/sessions/:id/history', (c) => {
  const id = c.req.param('id');
  if (!store.getSession(id)) return c.json({ error: 'NOT_FOUND' }, 404);
  const limit = Number(c.req.query('limit') || 200);
  const offset = Number(c.req.query('offset') || 0);
  return c.json({ messages: store.readJsonl(id, { limit, offset }) });
});

app.delete('/sessions/:id', (c) => {
  const ok = store.deleteSession(c.req.param('id'));
  return c.json({ ok });
});

app.post('/sessions/:id/abort', (c) => {
  const ok = store.abortSession(c.req.param('id'));
  return c.json({ ok });
});

// ---------- 发送消息 ----------
app.post('/sessions/:id/messages', async (c) => {
  const id = c.req.param('id');
  const s = store.getSession(id);
  if (!s) return c.json({ error: 'NOT_FOUND' }, 404);
  const body = (await c.req.json().catch(() => ({}))) as SendMessageRequest;
  if (!body?.message) return c.json({ error: 'message required' }, 400);

  const wantStream = body.stream !== false && (c.req.query('stream') !== '0');
  if (wantStream) return streamSession(c, id, body.message);
  return nonStreamSession(c, id, body.message);
});

// ---------- /chat 一次性接口（自动建/续 session） ----------
app.post('/chat', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    sessionId?: string;
    message: string;
    stream?: boolean;
    options?: SessionCreateOptions;
  };
  if (!body?.message) return c.json({ error: 'message required' }, 400);
  let sessionId = body.sessionId;
  if (!sessionId || !store.getSession(sessionId)) {
    const created = store.createSession(body.options || {});
    sessionId = created.sessionId;
  }
  const wantStream = body.stream !== false && (c.req.query('stream') !== '0');
  if (wantStream) return streamSession(c, sessionId, body.message);
  return nonStreamSession(c, sessionId, body.message);
});

// ------------------------------------------------------------------
// UnifiedEvent → chat:* SSE 映射 + 优先级
// 对齐根目录 src/server/sse.ts 的 SSE_EVENT_PRIORITIES
// ------------------------------------------------------------------
interface SseMapping {
  event: string;
  priority: SseEventPriority;
  payload: Record<string, unknown>;
}

function mapUnifiedToSse(ev: UnifiedEvent, sessionId: string): SseMapping | null {
  switch (ev.kind) {
    case 'text_delta':
      return { event: 'chat:message-chunk', priority: 'coalescible', payload: { sessionId, text: ev.text } };
    case 'text_stop':
      return { event: 'chat:content-block-stop', priority: 'critical', payload: { sessionId, kind: 'text' } };
    case 'thinking_start':
      return { event: 'chat:thinking-start', priority: 'critical', payload: { sessionId, index: ev.index } };
    case 'thinking_delta':
      return { event: 'chat:thinking-chunk', priority: 'coalescible', payload: { sessionId, text: ev.text, index: ev.index } };
    case 'thinking_stop':
      return { event: 'chat:content-block-stop', priority: 'critical', payload: { sessionId, kind: 'thinking', index: ev.index } };
    case 'tool_use_start':
      return {
        event: 'chat:tool-use-start',
        priority: 'critical',
        payload: { sessionId, toolUseId: ev.toolUseId, toolName: ev.toolName, input: ev.input },
      };
    case 'tool_input_delta':
      return { event: 'chat:tool-input-delta', priority: 'coalescible', payload: { sessionId, toolUseId: ev.toolUseId, delta: ev.delta } };
    case 'tool_use_stop':
      return { event: 'chat:content-block-stop', priority: 'critical', payload: { sessionId, kind: 'tool_use', toolUseId: ev.toolUseId } };
    case 'tool_result_delta':
      return { event: 'chat:tool-result-delta', priority: 'coalescible', payload: { sessionId, toolUseId: ev.toolUseId, delta: ev.delta } };
    case 'tool_result':
      return {
        event: 'chat:tool-result-complete',
        priority: 'critical',
        payload: {
          sessionId,
          toolUseId: ev.toolUseId,
          content: ev.content,
          isError: ev.isError,
          metadata: ev.metadata,
        },
      };
    case 'permission_request':
      return {
        event: 'permission:request',
        priority: 'critical',
        payload: {
          sessionId,
          requestId: ev.requestId,
          toolName: ev.toolName,
          toolUseId: ev.toolUseId,
          input: ev.input,
          suggestions: ev.suggestions,
        },
      };
    case 'session_init':
      return {
        event: 'chat:system-init',
        priority: 'critical',
        payload: { sessionId, sdkSessionId: ev.sessionId, model: ev.model, tools: ev.tools },
      };
    case 'status_change':
      return { event: 'chat:status', priority: 'critical', payload: { sessionId, state: ev.state } };
    case 'turn_complete':
      return { event: 'chat:message-complete', priority: 'critical', payload: { sessionId, result: ev.result } };
    case 'session_complete':
      return {
        event: 'chat:message-complete',
        priority: 'critical',
        payload: { sessionId, result: ev.result, subtype: ev.subtype, sdkSessionId: ev.sdkSessionId },
      };
    case 'usage':
      return {
        event: 'chat:usage',
        priority: 'droppable',
        payload: {
          sessionId,
          inputTokens: ev.inputTokens,
          outputTokens: ev.outputTokens,
          cacheReadTokens: ev.cacheReadTokens,
          cacheCreationTokens: ev.cacheCreationTokens,
          costUsd: ev.costUsd,
          model: ev.model,
        },
      };
    case 'model_update':
      return { event: 'chat:model-update', priority: 'critical', payload: { sessionId, model: ev.model } };
    case 'log':
      return { event: 'chat:log', priority: 'droppable', payload: { sessionId, level: ev.level, message: ev.message } };
    case 'raw':
      return { event: 'chat:raw', priority: 'droppable', payload: { sessionId, data: ev.data } };
    default:
      return null;
  }
}

// ---------- helpers ----------
function buildHistory(sessionId: string): { role: 'user' | 'assistant'; content: string }[] {
  const msgs = store.readJsonl(sessionId);
  const history: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const m of msgs) {
    if (m.role === 'user' || m.role === 'assistant') {
      history.push({ role: m.role, content: m.content });
    }
  }
  return history;
}

async function streamSession(c: any, sessionId: string, message: string) {
  const s = store.getSession(sessionId);
  if (!s) return c.json({ error: 'NOT_FOUND' }, 404);
  store.recordUserMessage(sessionId, message);

  const controller = new AbortController();
  store.markStart(sessionId, controller);

  return streamSSE(c, async (stream) => {
    const assistantChunks: string[] = [];

    // 发送 init
    await stream.writeSSE({
      event: 'chat:init',
      data: JSON.stringify({ sessionId, priority: 'critical' }),
    });

    try {
      const history = buildHistory(sessionId);
      // 最后一条是刚加的 user 消息，去掉避免重复
      history.pop();

      for await (const ev of runAgent({
        prompt: message,
        history,
        options: s.options,
        abortController: controller,
      })) {
        try { store.recordEvent(sessionId, ev); } catch {}
        if (ev.kind === 'text_delta') assistantChunks.push(ev.text);

        const mapped = mapUnifiedToSse(ev, sessionId);
        if (!mapped) continue;
        await stream.writeSSE({
          event: mapped.event,
          data: JSON.stringify({ ...mapped.payload, _priority: mapped.priority }),
        });
      }
    } catch (e: any) {
      await stream.writeSSE({
        event: 'chat:message-error',
        data: JSON.stringify({
          sessionId,
          message: e.message,
          _priority: 'critical',
        }),
      });
    } finally {
      if (assistantChunks.length) {
        store.recordAssistantMessage(sessionId, assistantChunks.join(''));
      }
      store.markEnd(sessionId);
      await stream.writeSSE({
        event: 'chat:done',
        data: JSON.stringify({ sessionId, _priority: 'critical' }),
      });
    }
  });
}

async function nonStreamSession(c: any, sessionId: string, message: string) {
  const s = store.getSession(sessionId);
  if (!s) return c.json({ error: 'NOT_FOUND' }, 404);
  store.recordUserMessage(sessionId, message);

  const controller = new AbortController();
  store.markStart(sessionId, controller);
  const events: UnifiedEvent[] = [];
  const texts: string[] = [];
  let finalResult = '';
  let subtype: string | undefined;

  try {
    const history = buildHistory(sessionId);
    history.pop();

    for await (const ev of runAgent({
      prompt: message,
      history,
      options: s.options,
      abortController: controller,
    })) {
      events.push(ev);
      try { store.recordEvent(sessionId, ev); } catch {}
      if (ev.kind === 'text_delta') texts.push(ev.text);
      if (ev.kind === 'session_complete') {
        finalResult = ev.result;
        subtype = ev.subtype;
      }
    }
  } finally {
    if (texts.length) store.recordAssistantMessage(sessionId, texts.join(''));
    store.markEnd(sessionId);
  }

  return c.json({
    sessionId,
    reply: finalResult || texts.join(''),
    subtype,
    events,
  });
}
