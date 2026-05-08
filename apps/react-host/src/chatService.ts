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

async function fetchOpenAiStream(
  message: string,
  handlers: StreamChatHandlers,
  options: StreamChatOptions = {},
): Promise<void> {
  const response = await fetch('/proxy-openai/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${import.meta.env.VITE_OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: import.meta.env.VITE_OPENAI_MODEL,
      stream: true,
      messages: [
        {
          role: 'system',
          content: '你是看山。你要像桌面陪伴角色一样说话。句子短。语气平静。内容自然。',
        },
        {
          role: 'user',
          content: message,
        },
      ],
      thinking: {
        type: 'disabled'
      }
    }),
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
    await fetchOpenAiStream(trimmedMessage, handlers, options);
  } catch (error) {
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    handlers.onError?.(normalizedError, '');
    throw normalizedError;
  }
}
