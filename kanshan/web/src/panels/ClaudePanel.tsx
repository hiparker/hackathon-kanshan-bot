import { useEffect, useRef, useState } from 'react';
import { API_BASE, api } from '../api';

interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
}

interface Session {
  sessionId: string;
  userId: string;
  createdAt: number;
  lastActiveAt: number;
  messageCount: number;
  running: boolean;
}

export default function ClaudePanel({ userId }: { userId: string }) {
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState('');
  const [health, setHealth] = useState<any>(null);
  const [quota, setQuota] = useState<{ limit: number; used: number; remaining: number } | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [showSessionList, setShowSessionList] = useState(false);
  const [creatingSession, setCreatingSession] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const refreshHealth = async () => {
    try {
      const h = await api('/claude/health');
      setHealth(h);
      setErr('');
    } catch (e: any) {
      setHealth(null);
      setErr('sidecar 未启动: ' + e.message);
    }
  };

  const fetchSessions = async () => {
    if (!userId) return;
    setLoadingSessions(true);
    try {
      const s = await api('/claude/sessions?userId=' + encodeURIComponent(userId));
      // 检查返回数据的结构
      console.log("Fetched sessions data:", s);
      // 处理不同的数据结构 - 正确处理 {sessions: [...]}
      let sessionsList: any[] = [];
      if (Array.isArray(s)) {
        sessionsList = s;
      } else if (s && typeof s === 'object') {
        // 优先检查是否有 sessions 字段
        if (Array.isArray(s.sessions)) {
          sessionsList = s.sessions;
        } else if (Array.isArray(s.items) || Array.isArray(s.list)) {
          sessionsList = s.items || s.list;
        } else if (Object.keys(s).length > 0) {
          // 如果不是数组，但有 key，可能是对象形式
          sessionsList = Object.values(s).filter(item => 
            item && typeof item === 'object' && 'sessionId' in item
          );
        }
      }
      console.log("Processed sessions list:", sessionsList);
      setSessions(sessionsList);
    } catch (e) {
      console.error("Failed to fetch sessions:", e);
      setSessions([]);
    } finally {
      setLoadingSessions(false);
    }
  };

  const switchSession = async (s: Session) => {
    setSessionId(s.sessionId);
    setShowSessionList(false);
    setMsgs([]);
    setErr('');
    // 加载会话历史 - 使用新的干净的 API
    try {
      const messages = await api(`/claude/sessions/${s.sessionId}/messages`);
      console.log("Fetched clean messages:", messages);
      setMsgs(Array.isArray(messages) ? messages : []);
    } catch (e) {
      console.error("Failed to load clean messages:", e);
      // 失败时，尝试回到旧的方法
      try {
        const history = await api(`/claude/sessions/${s.sessionId}/history`);
        console.log("Fetched fallback history:", history);
        if (Array.isArray(history)) {
          const messages = history.filter((m: any) => m.role === 'user' || m.role === 'assistant');
          setMsgs(messages);
        }
      } catch (err) {
        console.error("Fallback also failed:", err);
      }
    }
  };

  useEffect(() => { refreshHealth(); }, [userId]);
  useEffect(() => { fetchSessions(); }, [userId]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs]);

  useEffect(() => {
    if (!userId) return;
    api('/claude/usage?userId=' + encodeURIComponent(userId) + '&kind=chat')
      .then((d: any) => setQuota(d))
      .catch(() => {});
  }, [userId, msgs.length]);

  const send = async () => {
    const text = input.trim();
    if (!text || running) return;
    setInput('');
    setErr('');

    const userMsg: ChatMsg = { role: 'user', content: text };
    setMsgs(prev => [...prev, userMsg]);

    const assistantMsg: ChatMsg = { role: 'assistant', content: '' };
    setMsgs(prev => [...prev, assistantMsg]);

    setRunning(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const resp = await fetch(`${API_BASE}/claude/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          message: text,
          sessionId: sessionId || undefined,
          stream: true,
        }),
        signal: ctrl.signal,
      });

      if (!resp.ok) {
        const errBody = await resp.text();
        let detail = `请求失败 (${resp.status})`;
        try {
          const j = JSON.parse(errBody);
          detail = j.detail?.message || j.detail || j.error || detail;
        } catch {}
        throw new Error(detail);
      }

      const quotaHeader = resp.headers.get('X-Quota-Remaining');
      if (quotaHeader) {
        setQuota(prev => prev ? { ...prev, remaining: parseInt(quotaHeader) } : null);
      }

      if (!resp.body) throw new Error('无响应流');

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent = 'message';
      let sid = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';
        for (const block of parts) {
          const lines = block.split('\n');
          let data = '';
          for (const line of lines) {
            if (line.startsWith('event:')) currentEvent = line.slice(6).trim();
            else if (line.startsWith('data:')) data += line.slice(5).trim();
          }
          if (!data) continue;
          let parsed: any;
          try { parsed = JSON.parse(data); } catch { parsed = data; }

          if (
            (currentEvent === 'chat:message-chunk' ||
              currentEvent === 'assistant_text' ||
              currentEvent === 'text_delta') &&
            parsed?.text
          ) {
            setMsgs(prev => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last && last.role === 'assistant') {
                next[next.length - 1] = { ...last, content: last.content + parsed.text };
              }
              return next;
            });
          }

          if (currentEvent === 'chat:done' || currentEvent === 'chat:message-complete') {
            sid = parsed?.sessionId || '';
          }

          if (currentEvent === 'chat:message-error' && parsed?.message) {
            setErr(String(parsed.message));
          }
        }
      }

      if (sid) setSessionId(sid);
      fetchSessions(); // 刷新会话列表
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        setErr(e.message);
        setMsgs(prev => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last && last.role === 'assistant' && !last.content) {
            next.pop();
          }
          return next;
        });
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  const newSession = async () => {
    if (creatingSession) return;
    setCreatingSession(true);
    try {
      const session = await api('/claude/sessions', {
        method: 'POST',
        body: { userId },
      });
      setSessionId(session.sessionId || '');
      fetchSessions();
    } catch (e) {
      console.error("Failed to create session:", e);
      setSessionId('');
    } finally {
      setMsgs([]);
      setErr('');
      setCreatingSession(false);
    }
  };

  const formatDate = (ms: number) => {
    const d = new Date(ms);
    return d.toLocaleDateString('zh-CN', { 
      month: 'short', 
      day: 'numeric', 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  const quotaPercent = quota ? Math.round((quota.used / quota.limit) * 100) : 0;
  const quotaColor = quotaPercent > 80 ? '#ff6b6b' : quotaPercent > 50 ? '#ffd93d' : '#51cf66';

  return (
    <div className="chat-container">
      <div className="chat-header">
        <div className="chat-header-left">
          <h2>Claude 对话</h2>
          {health ? (
            <span className="health-badge connected">
              <span className="dot" />
              {health.model}
            </span>
          ) : (
            <span className="health-badge disconnected">
              <span className="dot" />
              未连接
            </span>
          )}
        </div>
        <div className="chat-header-right">
          {quota && (
            <div className="quota-bar-wrap" title={`今日已用 ${quota.used}/${quota.limit}`}>
              <div className="quota-bar">
                <div className="quota-fill" style={{ width: `${Math.min(quotaPercent, 100)}%`, background: quotaColor }} />
              </div>
              <span className="quota-text">{quota.remaining}</span>
            </div>
          )}
          {sessionId && (
            <span className="session-badge">
              会话: {sessionId.slice(0, 10)}...
            </span>
          )}
          <button 
            className="btn-new" 
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              newSession();
            }}
            onMouseDown={(e) => {
              e.preventDefault();
            }}
            disabled={creatingSession}
            style={{
              position: 'relative',
              zIndex: 9999,
              pointerEvents: 'auto',
              cursor: creatingSession ? 'wait' : 'pointer',
            }}
          >
            {creatingSession ? '创建中...' : '+ 新建'}
          </button>
          <button 
            className="btn-new" 
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setShowSessionList(!showSessionList);
            }}
            style={{
              position: 'relative',
              zIndex: 9999,
              pointerEvents: 'auto',
            }}
          >
            📋 历史
          </button>
        </div>
      </div>

      {showSessionList && (
        <div className="session-list-overlay" onClick={() => setShowSessionList(false)}>
          <div className="session-list" onClick={(e) => e.stopPropagation()}>
            <div className="session-list-header">
              <h3>历史会话</h3>
              <button className="btn-close" onClick={() => setShowSessionList(false)}>✕</button>
            </div>
            <div className="session-list-content">
              {loadingSessions && <div className="loading">加载中...</div>}
              {sessions.length === 0 && !loadingSessions && (
                <div className="no-sessions">暂无历史会话</div>
              )}
              {sessions.map((s) => (
                <div 
                  key={s.sessionId} 
                  className={`session-item ${s.sessionId === sessionId ? 'active' : ''}`}
                  onClick={() => switchSession(s)}
                >
                  <div className="session-item-info">
                    <div className="session-item-title">
                      会话 {s.sessionId.slice(0, 8)}...
                    </div>
                    <div className="session-item-meta">
                      {formatDate(s.lastActiveAt)} · {s.messageCount} 条消息
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {err && <div className="error-bar">{err}</div>}

      <div className="chat-messages-area">
        {msgs.length === 0 && (
          <div className="welcome">
            <div className="welcome-icon">🦊</div>
            <h3>与刘看山开始对话</h3>
            <p>输入消息开始聊天，支持多轮记忆和流式输出</p>
            <div className="welcome-tips">
              <span>💬 多轮对话记忆</span>
              <span>⚡ 流式实时输出</span>
              <span>🔒 用户隔离配额</span>
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`chat-msg ${m.role}`}>
            <div className="msg-avatar">{m.role === 'user' ? '👤' : '🦊'}</div>
            <div className="msg-body">
              <div className="msg-author">{m.role === 'user' ? userId : 'Claude'}</div>
              <div className="msg-text">
                {m.content || (m.role === 'assistant' && i === msgs.length - 1 && running ? (
                  <span className="typing"><span /><span /><span /></span>
                ) : '')}
              </div>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="chat-input-area">
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
          }}
          placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
          disabled={running}
          rows={1}
        />
        <button className="btn-send" onClick={send} disabled={running || !input.trim()}>
          {running ? <span className="spinner" /> : '发送'}
        </button>
      </div>
    </div>
  );
}
