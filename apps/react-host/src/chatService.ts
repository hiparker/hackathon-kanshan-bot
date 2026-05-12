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

const IS_DESKTOP_PROD = import.meta.env.MODE === 'desktop' && import.meta.env.PROD;
const OPENAI_BASE_URL = (import.meta.env.VITE_OPENAI_BASE_URL?.replace(/\/$/, '') || 'https://api.openai.com/v1');
const CHAT_COMPLETIONS_URL = IS_DESKTOP_PROD && OPENAI_BASE_URL
  ? `${OPENAI_BASE_URL}/chat/completions`
  : '/proxy-openai/chat/completions';

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

function useSecondMeChat(): boolean {
  const v = import.meta.env.VITE_SECONDME_CHAT;
  return v === '1' || v === 'true';
}

/** SecondMe Lab：POST /api/secondme/chat/stream，单轮 message + 可选 systemPrompt（与 OpenAI messages[] 互转） */
function messagesToSecondMePayload(messages: ChatMessage[]): {
  message: string;
  systemPrompt?: string;
} {
  const systemParts = messages.filter((m) => m.role === 'system').map((m) => m.content.trim()).filter(Boolean);
  const systemPrompt = systemParts.length > 0 ? systemParts.join('\n\n') : undefined;

  const dialogue = messages.filter((m) => m.role !== 'system');
  let message: string;
  if (dialogue.length === 0) {
    message = '';
  } else if (dialogue.length === 1) {
    const only = dialogue[0]!;
    message = only.role === 'user' ? only.content : `助手：${only.content}`;
  } else {
    message = dialogue
      .map((m) => {
        const label = m.role === 'user' ? '用户' : '助手';
        return `${label}：${m.content}`;
      })
      .join('\n\n');
  }

  return { message, systemPrompt };
}

async function fetchOpenAiStream(
  messages: ChatMessage[],
  handlers: StreamChatHandlers,
  options: StreamChatOptions = {},
): Promise<void> {
  const secondMe = useSecondMeChat();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${import.meta.env.VITE_OPENAI_API_KEY}`,
  };
  const appId = import.meta.env.VITE_SECONDME_APP_ID;
  if (appId) {
    headers['X-App-Id'] = appId;
  }

  let body: Record<string, unknown>;
  if (secondMe) {
    const { message, systemPrompt } = messagesToSecondMePayload(messages);
    body = {
      message,
      ...(systemPrompt ? { systemPrompt } : {}),
      ...(import.meta.env.VITE_OPENAI_MODEL ? { model: import.meta.env.VITE_OPENAI_MODEL } : {}),
    };
    const maxTok = import.meta.env.VITE_SECONDME_MAX_TOKENS;
    if (maxTok) {
      const n = Number(maxTok);
      if (Number.isFinite(n) && n > 0) {
        body.maxTokens = n;
      }
    }
    if (import.meta.env.VITE_SECONDME_WEB_SEARCH === '1' || import.meta.env.VITE_SECONDME_WEB_SEARCH === 'true') {
      body.enableWebSearch = true;
    }
  } else {
    body = {
      model: import.meta.env.VITE_OPENAI_MODEL,
      stream: true,
      messages,
      thinking: {
        type: 'disabled',
      },
    };
  }

  const response = await fetch(CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: options.signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Chat request failed with status ${response.status}: ${errorText}`);
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
