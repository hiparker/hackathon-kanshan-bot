/**
 * Sidecar 入口：启动 Hono 服务 + 定期 GC 会话。
 */
import { serve } from '@hono/node-server';

import { app } from './routes.js';
import { ensureAgentCwd, getConfig } from './config.js';
import { gc, loadFromDisk } from './sessions.js';

async function main() {
  const cfg = getConfig();
  ensureAgentCwd();
  loadFromDisk();

  if (!cfg.anthropicApiKey) {
    console.warn('[sidecar] ⚠️  未检测到 ANTHROPIC_API_KEY，Claude 调用将失败');
  }

  serve({ fetch: app.fetch, hostname: cfg.host, port: cfg.port }, (info) => {
    console.log('✨ 刘看山 Sidecar 启动完成');
    console.log(`   ➜ http://${info.address}:${info.port}`);
    console.log(`   ➜ runtime=${cfg.runtime}  model=${cfg.claudeModel}`);
    console.log(`   ➜ MCP servers: ${Object.keys(cfg.mcp.mcpServers).join(', ') || '(none)'}`);
    console.log(`   ➜ cwd=${cfg.agentCwd}  permission=${cfg.permissionMode}`);
    console.log(`   ➜ data=${cfg.dataDir}`);
  });

  // 每 10 分钟 GC 一次：1 小时不活跃且不在运行的会话清掉
  const TTL = 60 * 60 * 1000;
  setInterval(() => {
    const n = gc(TTL);
    if (n > 0) console.log(`[sidecar] gc: 清理了 ${n} 个不活跃会话`);
  }, 10 * 60 * 1000);
}

main().catch((e) => {
  console.error('[sidecar] 启动失败:', e);
  process.exit(1);
});
