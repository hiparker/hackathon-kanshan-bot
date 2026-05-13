/**
 * 环境变量 + mcp.json 加载。热重载：调用 reloadConfig()。
 */
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

import type { AgentRuntime, McpConfig, PermissionMode } from './types.js';

dotenv.config();

export interface SidecarConfig {
  port: number;
  host: string;
  anthropicApiKey: string;
  anthropicBaseUrl?: string;
  claudeModel: string;
  runtime: AgentRuntime;
  permissionMode: PermissionMode;
  agentCwd: string;
  /** 会话持久化目录（JSONL + meta） */
  dataDir: string;
  allowedTools: string[];
  mcpConfigPath: string;
  mcp: McpConfig;
  sidecarToken: string;
}

function parseList(v: string | undefined): string[] {
  if (!v) return [];
  return v.split(',').map((x) => x.trim()).filter(Boolean);
}

function loadMcp(p: string): McpConfig {
  const resolved = path.resolve(p);
  if (!fs.existsSync(resolved)) {
    console.warn(`[sidecar] mcp 配置不存在: ${resolved}（跳过 MCP）`);
    return { mcpServers: {} };
  }
  try {
    const raw = fs.readFileSync(resolved, 'utf-8');
    const parsed = JSON.parse(raw) as McpConfig;
    if (!parsed.mcpServers || typeof parsed.mcpServers !== 'object') {
      return { mcpServers: {} };
    }
    return parsed;
  } catch (e) {
    console.warn(`[sidecar] mcp 配置解析失败，fallback 空配置: ${(e as Error).message}`);
    return { mcpServers: {} };
  }
}

function build(): SidecarConfig {
  const runtime = (process.env.AGENT_RUNTIME || 'sdk').toLowerCase();
  const mcpPath = process.env.MCP_CONFIG_PATH || './mcp.json';
  return {
    port: Number(process.env.SIDECAR_PORT || 8788),
    host: process.env.SIDECAR_HOST || '0.0.0.0',
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
    anthropicBaseUrl: process.env.ANTHROPIC_BASE_URL || undefined,
    claudeModel: process.env.CLAUDE_MODEL || 'kimi-for-coding',
    runtime: (runtime === 'cli' ? 'cli' : 'sdk') as AgentRuntime,
    permissionMode: (process.env.PERMISSION_MODE || 'default') as PermissionMode,
    agentCwd: path.resolve(process.env.AGENT_CWD || './workspace'),
    dataDir: path.resolve(process.env.SIDECAR_DATA_DIR || './data'),
    allowedTools: parseList(process.env.ALLOWED_TOOLS),
    mcpConfigPath: mcpPath,
    mcp: loadMcp(mcpPath),
    sidecarToken: process.env.SIDECAR_TOKEN || '',
  };
}

let current: SidecarConfig = build();

export function getConfig(): SidecarConfig {
  return current;
}

export function reloadConfig(): SidecarConfig {
  // 重新读取 .env 不会覆盖已存在变量，这里只重建运行态字段 + 重读 mcp.json
  current = build();
  return current;
}

export function ensureAgentCwd() {
  const cfg = getConfig();
  try {
    fs.mkdirSync(cfg.agentCwd, { recursive: true });
  } catch {}
}
