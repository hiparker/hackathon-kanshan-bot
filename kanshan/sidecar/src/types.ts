/**
 * Sidecar 共享类型（对齐根目录 src/server/runtimes/types.ts 的 UnifiedEvent 模型）
 *
 * UI 权限模式（auto/plan/fullAgency/custom）→ SDK 权限模式
 * （acceptEdits/plan/bypassPermissions/default）的映射在 agent.ts。
 */

/** UI 层暴露的权限模式（对齐根目录） */
export type UiPermissionMode = 'auto' | 'plan' | 'fullAgency' | 'custom';

/** Claude Agent SDK 实际使用的权限模式 */
export type SdkPermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';

/** 兼容旧字段名 */
export type PermissionMode = UiPermissionMode | SdkPermissionMode;

export type AgentRuntime = 'sdk' | 'cli';

export interface McpServerConfig {
  type?: 'stdio' | 'sse' | 'http';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

export interface McpConfig {
  mcpServers: Record<string, McpServerConfig>;
}

export interface SessionCreateOptions {
  userId?: string;
  systemPrompt?: string;
  model?: string;
  /**
   * MCP 工具白名单。命名约定：`mcp__<server-id>__<tool-name>`
   * 未设置 → 默认放行所有工具；空数组 → 禁用所有 MCP 工具。
   */
  allowedTools?: string[];
  disallowedTools?: string[];
  /**
   * MCP 服务白名单（server id）。设置后仅命中此列表的 mcp__<id>__* 工具放行。
   * null/undefined 表示不限制。
   */
  enabledMcpServers?: string[] | null;
  permissionMode?: PermissionMode;
  cwd?: string;
  mcpServers?: Record<string, McpServerConfig>;
  /** 额外注入的系统上下文（从 Python 端的记忆 / 摘要拼过来） */
  additionalSystem?: string;
  /** 最大轮次 */
  maxTurns?: number;
}

export interface SessionMeta {
  sessionId: string;
  userId?: string;
  createdAt: number;
  lastActiveAt: number;
  messageCount: number;
  running: boolean;
  sdkSessionId?: string;
  options: SessionCreateOptions;
}

export interface SendMessageRequest {
  message: string;
  stream?: boolean;
}

/**
 * 统一事件模型（UnifiedEvent） —— 完整对齐根目录 src/server/runtimes/types.ts。
 * 所有 AgentRuntime（sdk / cli）都映射到这套事件，路由层再翻译成 chat:* SSE。
 */
export type UnifiedEvent =
  // === Text streaming ===
  | { kind: 'text_delta'; text: string }
  | { kind: 'text_stop' }

  // === Thinking / reasoning streaming ===
  | { kind: 'thinking_start'; index: number }
  | { kind: 'thinking_delta'; text: string; index: number }
  | { kind: 'thinking_stop'; index: number }

  // === Tool use ===
  | { kind: 'tool_use_start'; toolUseId: string; toolName: string; input?: Record<string, unknown> }
  | { kind: 'tool_input_delta'; toolUseId: string; delta: string }
  | { kind: 'tool_use_stop'; toolUseId: string }
  | { kind: 'tool_result_delta'; toolUseId: string; delta: string }
  | {
      kind: 'tool_result';
      toolUseId: string;
      content: string;
      isError?: boolean;
      metadata?: {
        exitCode?: number | null;
        durationMs?: number | null;
        cwd?: string;
        status?: string;
      };
    }

  // === Permission delegation ===
  | {
      kind: 'permission_request';
      requestId: string;
      toolName: string;
      toolUseId: string;
      input: Record<string, unknown>;
      suggestions?: unknown[];
    }

  // === Session lifecycle ===
  | { kind: 'session_init'; sessionId: string; model: string; tools: string[] }
  | { kind: 'status_change'; state: 'idle' | 'running' | 'waiting_permission' | 'error' }
  | { kind: 'turn_complete'; result?: string }
  | {
      kind: 'session_complete';
      result: string;
      subtype: 'success' | 'error' | 'error_max_turns' | 'error_max_budget';
      sdkSessionId?: string;
    }

  // === Metadata ===
  | {
      kind: 'usage';
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens?: number;
      cacheCreationTokens?: number;
      costUsd?: number;
      model?: string;
    }
  | { kind: 'model_update'; model: string }
  | { kind: 'log'; level: 'info' | 'warn' | 'error'; message: string }

  // === Passthrough ===
  | { kind: 'raw'; data: unknown };

/** 为方便旧代码过渡，导出 AgentEvent 作为 UnifiedEvent 别名 */
export type AgentEvent = UnifiedEvent;

/**
 * 会话层对外发出的消息条目（JSONL 一行一条）。
 */
export interface PersistedMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system' | 'event';
  /** 文本内容（assistant 聚合后的完整文本；user 为用户输入；event 为结构化事件） */
  content: string;
  /** 原始事件（role=event 时必填） */
  event?: UnifiedEvent;
  timestamp: number;
}

/** SSE 事件优先级（对齐根目录 sse.ts） */
export type SseEventPriority = 'critical' | 'coalescible' | 'droppable';

/**
 * SDK/CLI 的 session 已经在上游失效（被 GC / 升级后格式不兼容）。
 * 上层捕获后应清掉 sdkSessionId 并重试一次 fresh。
 */
export class StaleRuntimeSessionError extends Error {
  readonly isStaleRuntimeSession = true;
  constructor(public readonly runtimeSessionId: string, message: string) {
    super(message);
    this.name = 'StaleRuntimeSessionError';
  }
}
