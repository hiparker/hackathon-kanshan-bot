export interface StreamChatHandlers {
  onChunk: (chunk: string, nextText: string) => void;
  onDone?: (fullText: string) => void;
  onError?: (error: Error, partialText: string) => void;
}

export interface StreamChatOptions {
  signal?: AbortSignal;
}

interface OpenAiStreamDelta {
  content?: string;
}

interface OpenAiStreamChoice {
  delta?: OpenAiStreamDelta;
}

interface OpenAiStreamChunk {
  choices?: OpenAiStreamChoice[];
}

const DEFAULT_API_BASE_URL = import.meta.env.PROD ? 'https://kanshan.bedebug.com' : '';
const CONFIGURED_API_BASE_URL = import.meta.env.VITE_KANSHAN_API_BASE_URL || DEFAULT_API_BASE_URL;
const API_PREFIX = import.meta.env.PROD ? `${CONFIGURED_API_BASE_URL.replace(/\/$/, '')}/api` : '/api';
const CHAT_COMPLETIONS_URL = `${API_PREFIX}/chat/completions`;
const AUTH_STORAGE_KEY = 'kanshan.session';
const IS_DESKTOP_MODE = import.meta.env.MODE === 'desktop' || import.meta.env.VITE_KANSHAN_DESKTOP === 'true';
const DESKTOP_SESSION_TOKEN = import.meta.env.VITE_KANSHAN_DESKTOP_SESSION_TOKEN || 's_u_local-dev';

function consumeSseBuffer(
  buffer: string,
  onText: (text: string) => void,
): string {
  const parts = buffer.split('\n\n');
  const nextBuffer = parts.pop() ?? '';

  for (const part of parts) {
    const payload = part
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('\n');

    if (!payload || payload === '[DONE]') continue;

    try {
      const json = JSON.parse(payload) as OpenAiStreamChunk;
      const text = json.choices?.[0]?.delta?.content ?? '';
      if (text) onText(text);
      continue;
    } catch {
      onText(payload);
    }
  }

  return nextBuffer;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

function getSessionToken(): string {
  try {
    const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return IS_DESKTOP_MODE ? DESKTOP_SESSION_TOKEN : '';
    const session = JSON.parse(raw) as { sessionToken?: string; session_token?: string };
    return session.sessionToken || session.session_token || (IS_DESKTOP_MODE ? DESKTOP_SESSION_TOKEN : '');
  } catch {
    return IS_DESKTOP_MODE ? DESKTOP_SESSION_TOKEN : '';
  }
}

async function fetchOpenAiStream(
  messages: ChatMessage[],
  handlers: StreamChatHandlers,
  options: StreamChatOptions = {},
): Promise<void> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const sessionToken = getSessionToken();
  if (sessionToken) {
    headers['X-Session-Token'] = sessionToken;
  }

  const response = await fetch(CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ stream: true, messages }),
    signal: options.signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    const message = parseChatErrorMessage(errorText) ?? errorText;
    throw new Error(`Chat request failed with status ${response.status}: ${message}`);
  }

  if (!response.body) {
    throw new Error('Chat response body is empty.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';
  let sseBuffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const decoded = decoder.decode(value, { stream: true });
    if (!decoded) continue;

    sseBuffer += decoded;
    sseBuffer = consumeSseBuffer(sseBuffer, (chunk) => {
      fullText += chunk;
      handlers.onChunk(chunk, fullText);
    });
  }

  if (sseBuffer.trim()) {
    consumeSseBuffer(`${sseBuffer}\n\n`, (chunk) => {
      fullText += chunk;
      handlers.onChunk(chunk, fullText);
    });
  }

  handlers.onDone?.(fullText);
}

function parseChatErrorMessage(raw: string): string | null {
  try {
    const body = JSON.parse(raw) as {
      error?: {
        message?: string;
        details?: {
          upstream_status?: number;
          upstream_body?: string;
        };
      };
    };
    const upstreamStatus = body.error?.details?.upstream_status;
    const upstreamBody = body.error?.details?.upstream_body;
    if (upstreamStatus && upstreamBody) return `模型服务 ${upstreamStatus}: ${upstreamBody}`;
    return body.error?.message ?? null;
  } catch {
    return null;
  }
}

function buildDistilledSystemPrompt(profileBrief: string): string {
  return [
    '你是用户的「思维分身」Demo：模仿其论述习惯、价值取向与篇幅节奏来回答问题。',
    '要求：先给出可直接执行的判断或步骤，再补充理由；语气保持中文知乎答主风格，避免卖萌宠物口吻。',
    '素材片段仅供模仿风格与知识结构，不要宣称「我记得」「我写过原文」，可笼统说「按我过去的习惯会…」。',
    `【侧写】${profileBrief}`,
  ].join('\n');
}

export async function streamDistilledSelfChat(
  userMessage: string,
  profileBrief: string,
  snippets: Array<{ title: string; text: string }>,
  handlers: StreamChatHandlers,
  options: StreamChatOptions = {},
): Promise<void> {
  const trimmedMessage = userMessage.trim();
  if (!trimmedMessage) {
    const error = new Error('Message must not be empty.');
    handlers.onError?.(error, '');
    throw error;
  }

  const contextBlock = snippets
    .map((s, i) => `【片段${i + 1}】${s.title}\n${s.text}`)
    .join('\n\n');

  const userPayload = [
    '以下是用户历史写作片段（仅供模仿语气、论证习惯与知识边界，禁止整段照抄）：',
    '',
    contextBlock || '（暂无匹配片段，仅凭侧写模仿风格。）',
    '',
    '---',
    '',
    '当前提问：',
    trimmedMessage,
  ].join('\n');

  const messages: ChatMessage[] = [
    { role: 'system', content: buildDistilledSystemPrompt(profileBrief) },
    { role: 'user', content: userPayload },
  ];

  try {
    await fetchOpenAiStream(messages, handlers, options);
  } catch (error) {
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    handlers.onError?.(normalizedError, '');
    throw normalizedError;
  }
}

export async function streamChat(
  message: string,
  handlers: StreamChatHandlers,
  options: StreamChatOptions = {},
): Promise<void> {
  const trimmedMessage = message.trim();
  if (!trimmedMessage) {
    const error = new Error('Message must not be empty.');
    handlers.onError?.(error, '');
    throw error;
  }

  try {
    await fetchOpenAiStream(
      [
        {
          role: 'system',
          content: '你是看山。你要像桌面陪伴角色一样说话。句子短。语气平静。内容自然。',
        },
        {
          role: 'user',
          content: trimmedMessage,
        },
      ],
      handlers,
      options,
    );
  } catch (error) {
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    handlers.onError?.(normalizedError, '');
    throw normalizedError;
  }
}
