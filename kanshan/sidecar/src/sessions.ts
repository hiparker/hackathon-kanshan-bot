/**
 * 会话状态管理 + JSONL 持久化（简化版 SessionStore，对齐根目录 src/server/SessionStore.ts）。
 *
 * 每个 session 维护：
 *   - 自身 sessionId（sidecar 生成）
 *   - SDK 会话 id（首次 session_complete 事件返回后保存，用于后续 resume）
 *   - 基础配置（systemPrompt / tools / cwd / mcpServers ...）
 *   - 消息计数 + 时间戳
 *   - AbortController（用于取消运行中的调用）
 *
 * 持久化策略：
 *   - sessions.json：所有 session meta 全量（原子写）
 *   - sessions/<id>.jsonl：该会话所有消息 / 事件，追加式
 */
import fs from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';

import { getConfig } from './config.js';
import type {
  PersistedMessage,
  SessionCreateOptions,
  SessionMeta,
  UnifiedEvent,
} from './types.js';

interface SessionState extends SessionMeta {
  abortController?: AbortController;
}

const sessions = new Map<string, SessionState>();

// ------------------------------------------------------------------
// 持久化目录
// ------------------------------------------------------------------
function dataDir(): string {
  const cfg = getConfig();
  const dir = path.resolve(cfg.dataDir || './data');
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  try { fs.mkdirSync(path.join(dir, 'sessions'), { recursive: true }); } catch {}
  return dir;
}

function metaFile(): string {
  return path.join(dataDir(), 'sessions.json');
}

function sessionJsonl(sessionId: string): string {
  return path.join(dataDir(), 'sessions', `${sessionId}.jsonl`);
}

/** 原子写（先写 tmp 再 rename） */
function atomicWriteFile(file: string, content: string) {
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, content, 'utf-8');
  fs.renameSync(tmp, file);
}

function persistMeta() {
  try {
    const all: SessionMeta[] = Array.from(sessions.values()).map(snapshot);
    atomicWriteFile(metaFile(), JSON.stringify({ sessions: all }, null, 2));
  } catch (e) {
    console.warn('[sidecar] persistMeta failed:', (e as Error).message);
  }
}

/** 追加一行 JSONL（消息 / 事件） */
export function appendJsonl(sessionId: string, entry: PersistedMessage): void {
  try {
    fs.appendFileSync(sessionJsonl(sessionId), JSON.stringify(entry) + '\n', 'utf-8');
  } catch (e) {
    console.warn('[sidecar] appendJsonl failed:', (e as Error).message);
  }
}

/** 读取一个会话的所有消息（可选分页） */
export function readJsonl(
  sessionId: string,
  opts: { limit?: number; offset?: number } = {},
): PersistedMessage[] {
  const file = sessionJsonl(sessionId);
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf-8').split('\n').filter((l) => l.trim());
  const from = Math.max(0, opts.offset || 0);
  const to = opts.limit ? from + opts.limit : lines.length;
  const out: PersistedMessage[] = [];
  for (const line of lines.slice(from, to)) {
    try { out.push(JSON.parse(line) as PersistedMessage); } catch {}
  }
  return out;
}

// ------------------------------------------------------------------
// 启动时加载
// ------------------------------------------------------------------
export function loadFromDisk(): void {
  try {
    const file = metaFile();
    if (!fs.existsSync(file)) return;
    const raw = fs.readFileSync(file, 'utf-8');
    const parsed = JSON.parse(raw) as { sessions?: SessionMeta[] };
    if (!parsed?.sessions) return;
    for (const m of parsed.sessions) {
      sessions.set(m.sessionId, { ...m, running: false, abortController: undefined });
    }
    console.log(`[sidecar] 已加载 ${parsed.sessions.length} 个历史会话`);
  } catch (e) {
    console.warn('[sidecar] loadFromDisk failed:', (e as Error).message);
  }
}

// ------------------------------------------------------------------
// CRUD
// ------------------------------------------------------------------
export function createSession(options: SessionCreateOptions): SessionMeta {
  const sessionId = `sc_${nanoid(12)}`;
  const now = Date.now();
  const meta: SessionState = {
    sessionId,
    userId: options.userId,
    createdAt: now,
    lastActiveAt: now,
    messageCount: 0,
    running: false,
    options,
  };
  sessions.set(sessionId, meta);
  appendJsonl(sessionId, {
    id: nanoid(10),
    sessionId,
    role: 'system',
    content: 'session_created',
    timestamp: now,
  });
  persistMeta();
  return snapshot(meta);
}

export function getSession(sessionId: string): SessionState | undefined {
  return sessions.get(sessionId);
}

export function listSessions(userId?: string): SessionMeta[] {
  const all = Array.from(sessions.values()).map(snapshot);
  return userId ? all.filter((s) => s.userId === userId) : all;
}

export function deleteSession(sessionId: string): boolean {
  const s = sessions.get(sessionId);
  if (!s) return false;
  if (s.running && s.abortController) {
    try { s.abortController.abort(); } catch {}
  }
  sessions.delete(sessionId);
  try {
    const file = sessionJsonl(sessionId);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch {}
  persistMeta();
  return true;
}

export function abortSession(sessionId: string): boolean {
  const s = sessions.get(sessionId);
  if (!s || !s.running || !s.abortController) return false;
  try { s.abortController.abort(); } catch {}
  s.running = false;
  persistMeta();
  return true;
}

export function markStart(sessionId: string, controller: AbortController): SessionState | undefined {
  const s = sessions.get(sessionId);
  if (!s) return undefined;
  s.running = true;
  s.abortController = controller;
  s.lastActiveAt = Date.now();
  return s;
}

export function markEnd(sessionId: string, sdkSessionId?: string) {
  const s = sessions.get(sessionId);
  if (!s) return;
  s.running = false;
  s.abortController = undefined;
  s.messageCount += 1;
  s.lastActiveAt = Date.now();
  if (sdkSessionId) s.sdkSessionId = sdkSessionId;
  persistMeta();
}

/** 清掉 sdkSessionId（stale 恢复用） */
export function invalidateSdkSession(sessionId: string) {
  const s = sessions.get(sessionId);
  if (!s) return;
  s.sdkSessionId = undefined;
  persistMeta();
}

/** 便捷方法：记录一条用户消息 */
export function recordUserMessage(sessionId: string, content: string): void {
  appendJsonl(sessionId, {
    id: nanoid(10),
    sessionId,
    role: 'user',
    content,
    timestamp: Date.now(),
  });
}

/** 便捷方法：记录一条 assistant 完整回复 */
export function recordAssistantMessage(sessionId: string, content: string): void {
  appendJsonl(sessionId, {
    id: nanoid(10),
    sessionId,
    role: 'assistant',
    content,
    timestamp: Date.now(),
  });
}

/** 便捷方法：记录一个原始事件 */
export function recordEvent(sessionId: string, event: UnifiedEvent): void {
  appendJsonl(sessionId, {
    id: nanoid(10),
    sessionId,
    role: 'event',
    content: event.kind,
    event,
    timestamp: Date.now(),
  });
}

function snapshot(s: SessionState): SessionMeta {
  return {
    sessionId: s.sessionId,
    userId: s.userId,
    createdAt: s.createdAt,
    lastActiveAt: s.lastActiveAt,
    messageCount: s.messageCount,
    running: s.running,
    sdkSessionId: s.sdkSessionId,
    options: s.options,
  };
}

/** GC：清理超过 ttlMs 未活跃的会话 */
export function gc(ttlMs: number): number {
  const now = Date.now();
  let n = 0;
  for (const [id, s] of sessions.entries()) {
    if (s.running) continue;
    if (now - s.lastActiveAt > ttlMs) {
      sessions.delete(id);
      try {
        const file = sessionJsonl(id);
        if (fs.existsSync(file)) fs.unlinkSync(file);
      } catch {}
      n += 1;
    }
  }
  if (n > 0) persistMeta();
  return n;
}

export function stats() {
  let running = 0;
  for (const s of sessions.values()) if (s.running) running += 1;
  return { total: sessions.size, running };
}
