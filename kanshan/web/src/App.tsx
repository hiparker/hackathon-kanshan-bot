import { useState } from 'react';
import ClaudePanel from './panels/ClaudePanel';

export default function App() {
  const [userId, setUserId] = useState(() => localStorage.getItem('uid') || 'demo');

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          <span className="header-logo">🦊</span>
          <h1>刘看山 · Claude AI</h1>
        </div>
        <div className="header-right">
          <div className="user-id-group">
            <label>用户 ID</label>
            <input value={userId} onChange={(e) => { setUserId(e.target.value); localStorage.setItem('uid', e.target.value); }} placeholder="输入用户 ID" />
          </div>
        </div>
      </header>

      <div className="claude-layout">
        <aside className="api-docs">
          <div className="glass-card">
            <h2>📖 API 接入文档</h2>
            <p className="doc-desc">Claude 流式对话 API，支持多轮记忆、用户隔离、每日配额限制。</p>
          </div>

          <div className="glass-card">
            <h3>🔗 端点</h3>
            <div className="endpoint-row">
              <code className="method">POST</code>
              <code className="path">/api/claude/chat</code>
            </div>
          </div>

          <div className="glass-card">
            <h3>📦 请求体</h3>
            <pre className="code-block">{
`{
  "userId":    "string",  // 用户标识（必填）
  "message":   "string",  // 对话内容（必填）
  "sessionId": "string",  // 会话 ID（续聊时传入）
  "stream":    true       // 是否流式输出
}`}</pre>
          </div>

          <div className="glass-card">
            <h3>📡 SSE 事件</h3>
            <div className="event-list">
              <div className="event-item">
                <span className="event-name">chat:init</span>
                <span className="event-desc">会话初始化</span>
              </div>
              <div className="event-item">
                <span className="event-name">chat:message-chunk</span>
                <span className="event-desc">流式文本块</span>
              </div>
              <div className="event-item">
                <span className="event-name">chat:message-complete</span>
                <span className="event-desc">回复完成</span>
              </div>
              <div className="event-item">
                <span className="event-name">chat:message-error</span>
                <span className="event-desc">错误信息</span>
              </div>
              <div className="event-item">
                <span className="event-name">chat:usage</span>
                <span className="event-desc">Token 用量</span>
              </div>
              <div className="event-item">
                <span className="event-name">chat:done</span>
                <span className="event-desc">会话结束</span>
              </div>
            </div>
          </div>

          <div className="glass-card">
            <h3>🔒 配额限制</h3>
            <p>每个用户每日最多 <strong>100 次</strong> 对话调用，超出返回 <code>429</code>。</p>
          </div>

          <div className="glass-card">
            <h3>🧪 curl 示例</h3>
            <pre className="code-block">{
`curl -N -X POST /api/claude/chat \\
  -H "Content-Type: application/json" \\
  -d '{
    "userId": "demo",
    "message": "你好",
    "stream": true
  }'`}</pre>
          </div>

          <div className="glass-card">
            <h3>📊 当前状态</h3>
            <div className="status-grid">
              <div className="status-item">
                <span className="status-label">模型</span>
                <span className="status-value">kimi-for-coding</span>
              </div>
              <div className="status-item">
                <span className="status-label">运行时</span>
                <span className="status-value">Direct API</span>
              </div>
              <div className="status-item">
                <span className="status-label">记忆轮次</span>
                <span className="status-value">50 轮</span>
              </div>
              <div className="status-item">
                <span className="status-label">日配额</span>
                <span className="status-value">100 次/用户</span>
              </div>
            </div>
          </div>
        </aside>

        <main className="claude-main">
          <ClaudePanel userId={userId} />
        </main>
      </div>
    </div>
  );
}
