/**
 * Custom StreamFn that routes to our Python backend SSE endpoints.
 *
 * This bridges pi-agent-core's streaming interface with our backend's
 * /cloud/chat and /models/chat SSE endpoints.
 */

import http from 'node:http';
import type { ResolvedModel } from './types';

import { createAssistantMessageEventStream } from '@mariozechner/pi-ai';
import type { AssistantMessageEventStream } from '@mariozechner/pi-ai';

// ── Retry helpers ───────────────────────────────────────────────

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

function isTransientError(err: Error & { code?: string; statusCode?: number }): boolean {
  const code = err.code || '';
  if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ECONNREFUSED') return true;
  const status = err.statusCode || 0;
  if (status === 429 || status === 500 || status === 502 || status === 503) return true;
  const msg = err.message || '';
  if (/\b(429|500|502|503)\b/.test(msg)) return true;
  if (/ECONNRESET|ETIMEDOUT/.test(msg)) return true;
  return false;
}

function retryDelay(attempt: number): number {
  const base = BASE_DELAY_MS * Math.pow(2, attempt); // 1s, 2s, 4s
  const jitter = Math.random() * base * 0.5; // up to 50% jitter
  return base + jitter;
}

function sleepWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}

interface StreamFnContext {
  systemPrompt?: string;
  messages: Array<{
    role: string;
    content: string | Array<{ type: string; text?: string; id?: string; name?: string; arguments?: Record<string, unknown> }>;
    timestamp?: number;
    toolCallId?: string;
    toolName?: string;
    isError?: boolean;
  }>;
  tools?: Array<{ name: string; description: string; parameters: unknown }>;
}

interface BackendChatStreamEvent {
  token?: string | null;
  done?: boolean;
  finish_reason?: string | null;
  usage?: Record<string, unknown> | null;
  tool_calls?: Array<{ id: string; name: string; arguments: string }> | null;
}

// ── JSON repair & fuzzy matching utilities ──────────────────────

/**
 * Attempt to repair malformed JSON from small models.
 * Fixes: unquoted keys, trailing commas, unclosed brackets, and (as a last
 * resort) single-quoted strings — but only when doing so produces valid JSON.
 */
export function repairJson(input: string): string {
  let s = input.trim();

  // Fix unquoted keys: {key: "value"} → {"key": "value"}
  s = s.replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":');

  // Remove trailing commas before } or ]
  s = s.replace(/,\s*([}\]])/g, '$1');

  // Try to close unclosed brackets/braces
  let braces = 0;
  let brackets = 0;
  for (const ch of s) {
    if (ch === '{') braces++;
    else if (ch === '}') braces--;
    else if (ch === '[') brackets++;
    else if (ch === ']') brackets--;
  }
  while (brackets > 0) { s += ']'; brackets--; }
  while (braces > 0) { s += '}'; braces--; }

  // Try parsing as-is first
  try {
    JSON.parse(s);
    return s;
  } catch {
    // continue to single-quote repair
  }

  // Targeted single-quote replacement: only replace quotes at JSON structural
  // boundaries (keys and values delimited by single quotes adjacent to : , { } [ ])
  const quoted = s.replace(/(?<=[:,\[{(\s])'([^']*?)'(?=\s*[:,\]})])/g, '"$1"');
  try {
    JSON.parse(quoted);
    return quoted;
  } catch {
    // continue
  }

  // Brute-force: replace all single quotes, but only return the result if it
  // actually parses — otherwise return the structural-fix-only version to
  // avoid corrupting apostrophes in values (e.g. O'Brien)
  const brute = s.replace(/'/g, '"');
  try {
    JSON.parse(brute);
    return brute;
  } catch {
    return s;
  }
}

/**
 * Fuzzy-match a tool name against available tool names.
 * Returns the best match if similarity is high enough, otherwise the original.
 */
export function fuzzyMatchToolName(name: string, toolNames: string[]): string {
  if (!toolNames.length) return name;

  const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, '');

  // Exact match first
  for (const tn of toolNames) {
    if (tn.toLowerCase().replace(/[^a-z0-9]/g, '') === normalized) return tn;
  }

  // Prefix match
  for (const tn of toolNames) {
    const tnNorm = tn.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (tnNorm.startsWith(normalized) || normalized.startsWith(tnNorm)) return tn;
  }

  return name;
}

/**
 * Creates a streamFn bound to a specific resolved model and backend port.
 */
export function createBackendStreamFn(resolvedModel: ResolvedModel, backendPort: number, toolNames?: string[]) {
  // Return a function matching pi-agent-core's StreamFn type
  // StreamFn = (...args: Parameters<typeof streamSimple>) => AssistantMessageEventStream
  return function backendStreamFn(
    _model: unknown,
    context: StreamFnContext,
    options?: { signal?: AbortSignal; maxTokens?: number; temperature?: number },
  ): AssistantMessageEventStream {
    const stream = createAssistantMessageEventStream();

    // Convert pi-agent-core context to our backend format
    const backendMessages = convertMessages(context);
    const backendTools = convertTools(context.tools);

    // Determine endpoint
    const isLocal = resolvedModel.source === 'local';
    const path = isLocal ? '/models/chat' : '/cloud/chat';

    const body: Record<string, unknown> = {
      messages: backendMessages,
      stream: true,
      max_tokens: options?.maxTokens ?? 4096,
      temperature: options?.temperature ?? 0.7,
    };

    if (!isLocal) {
      body.provider = resolvedModel.provider;
      body.model = resolvedModel.modelId;
    }

    if (backendTools && backendTools.length > 0) {
      body.tools = backendTools;
    }

    // Start async streaming with retry on transient errors
    streamWithRetry(backendPort, path, body, stream, options?.signal, toolNames);

    return stream;
  };
}

/**
 * Retry wrapper around streamFromBackend. Retries up to MAX_RETRIES times
 * on transient errors (429, 5xx, ECONNRESET, ETIMEDOUT). Non-transient
 * errors (400, 401, 403) fail immediately.
 */
function streamWithRetry(
  port: number,
  path: string,
  body: Record<string, unknown>,
  stream: AssistantMessageEventStream,
  signal?: AbortSignal,
  toolNames?: string[],
  attempt = 0,
): void {
  streamFromBackend(port, path, body, stream, signal, toolNames, (err) => {
    const transient = isTransientError(err as Error & { code?: string; statusCode?: number });
    if (!transient || attempt >= MAX_RETRIES) {
      // Not retryable or exhausted retries — emit error
      emitError(stream, err.message);
      return;
    }
    const delay = retryDelay(attempt);
    console.log(`[Agent] Retrying stream (attempt ${attempt + 1}/${MAX_RETRIES}) after ${Math.round(delay)}ms: ${err.message}`);
    sleepWithSignal(delay, signal)
      .then(() => streamWithRetry(port, path, body, stream, signal, toolNames, attempt + 1))
      .catch(() => emitError(stream, 'Request aborted'));
  });
}

function convertMessages(context: StreamFnContext): Array<Record<string, unknown>> {
  const result: Array<Record<string, unknown>> = [];

  // Add system prompt
  if (context.systemPrompt) {
    result.push({ role: 'system', content: context.systemPrompt });
  }

  for (const msg of context.messages) {
    if (msg.role === 'user') {
      const content = typeof msg.content === 'string'
        ? msg.content
        : msg.content
            .filter((c) => c.type === 'text')
            .map((c) => c.text)
            .join('\n');
      result.push({ role: 'user', content });
    } else if (msg.role === 'assistant') {
      // Extract text and tool calls from content array
      const contentParts = Array.isArray(msg.content) ? msg.content : [];
      const textParts = contentParts
        .filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join('');
      const toolCalls = contentParts
        .filter((c) => c.type === 'toolCall')
        .map((c) => ({
          id: c.id ?? '',
          name: c.name ?? '',
          arguments: JSON.stringify(c.arguments ?? {}),
        }));

      const assistantMsg: Record<string, unknown> = { role: 'assistant' };
      if (textParts) assistantMsg.content = textParts;
      if (toolCalls.length > 0) assistantMsg.tool_calls = toolCalls;
      if (!textParts && toolCalls.length === 0) assistantMsg.content = '';
      result.push(assistantMsg);
    } else if (msg.role === 'toolResult') {
      result.push({
        role: 'tool',
        tool_call_id: (msg as any).toolCallId ?? '',
        tool_name: (msg as any).toolName ?? '',
        content: typeof msg.content === 'string'
          ? msg.content
          : Array.isArray(msg.content)
            ? msg.content
                .filter((c) => c.type === 'text')
                .map((c) => c.text)
                .join('\n')
            : '',
      });
    }
  }

  return result;
}

function convertTools(
  tools?: Array<{ name: string; description: string; parameters: unknown }>,
): Array<Record<string, unknown>> | null {
  if (!tools || tools.length === 0) return null;
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
}

function streamFromBackend(
  port: number,
  path: string,
  body: Record<string, unknown>,
  stream: AssistantMessageEventStream,
  signal?: AbortSignal,
  toolNames?: string[],
  onError?: (err: Error & { statusCode?: number }) => void,
): void {
  const bodyStr = JSON.stringify(body);

  const options: http.RequestOptions = {
    hostname: '127.0.0.1',
    port,
    path,
    method: 'POST',
    headers: {
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(bodyStr).toString(),
    },
  };

  const handleError = (err: Error & { statusCode?: number }) => {
    if (onError) onError(err);
    else emitError(stream, err.message);
  };

  const req = http.request(options, (res) => {
    if (res.statusCode && res.statusCode >= 400) {
      let errorBody = '';
      res.on('data', (chunk: Buffer) => {
        errorBody += chunk.toString();
      });
      res.on('end', () => {
        let errorMsg = `Backend error (${res.statusCode})`;
        try {
          const parsed = JSON.parse(errorBody);
          if (parsed.detail) errorMsg = parsed.detail;
        } catch {
          // use default
        }
        const err = Object.assign(new Error(errorMsg), { statusCode: res.statusCode! });
        handleError(err);
      });
      return;
    }

    let buffer = '';
    let contentIndex = 0;
    let accumulatedText = '';
    let toolCallIndex = 0;

    // ── State machine for text-based tag detection (Qwen-style <think>/<tool_call>) ──
    let tagMode: 'normal' | 'think' | 'tool_call' = 'normal';
    let toolCallJsonBuffer = '';
    let thinkBuffer = '';
    let pendingChars = '';
    let streamDone = false;

    function emitTextDelta(text: string) {
      if (!text) return;
      if (accumulatedText === '') {
        partialContent.push({ type: 'text', text: '' });
        stream.push({ type: 'text_start', contentIndex, partial: partial as any });
      }
      accumulatedText += text;
      (partialContent[contentIndex] as any).text = accumulatedText;
      stream.push({ type: 'text_delta', contentIndex, delta: text, partial: partial as any });
    }

    function emitToolCallFromText(jsonStr: string) {
      let parsed: { name?: string; arguments?: Record<string, unknown> };
      try {
        parsed = JSON.parse(jsonStr);
      } catch {
        // Attempt JSON repair before giving up
        try {
          parsed = JSON.parse(repairJson(jsonStr));
        } catch {
          // Invalid JSON — emit as regular text
          emitTextDelta(jsonStr);
          return;
        }
      }

      // Close open text block before emitting tool call
      if (accumulatedText !== '') {
        stream.push({ type: 'text_end', contentIndex, content: accumulatedText, partial: partial as any });
        contentIndex++;
        accumulatedText = '';
      }

      const id = `tc_${Date.now()}_${toolCallIndex}`;
      const args = parsed.arguments ?? {};
      const rawName = parsed.name ?? 'unknown';
      const matchedName = toolNames?.length ? fuzzyMatchToolName(rawName, toolNames) : rawName;
      const toolCall = {
        type: 'toolCall' as const,
        id,
        name: matchedName,
        arguments: args,
      };
      partialContent.push(toolCall);
      stream.push({ type: 'toolcall_start', contentIndex, partial: partial as any });
      stream.push({ type: 'toolcall_delta', contentIndex, delta: JSON.stringify(args), partial: partial as any });
      stream.push({ type: 'toolcall_end', contentIndex, toolCall, partial: partial as any });
      contentIndex++;
      toolCallIndex++;
    }

    function flushPending() {
      if (pendingChars) {
        emitTextDelta(pendingChars);
        pendingChars = '';
      }
      if (tagMode === 'tool_call' && toolCallJsonBuffer) {
        emitTextDelta(toolCallJsonBuffer);
        toolCallJsonBuffer = '';
      }
      thinkBuffer = '';
      tagMode = 'normal';
    }

    function processTextToken(token: string) {
      const input = pendingChars + token;
      pendingChars = '';

      if (tagMode === 'think') {
        thinkBuffer += input;
        const endIdx = thinkBuffer.indexOf('</think>');
        if (endIdx !== -1) {
          tagMode = 'normal';
          const after = thinkBuffer.slice(endIdx + 8);
          thinkBuffer = '';
          if (after) processTextToken(after);
        }
        return;
      }

      if (tagMode === 'tool_call') {
        toolCallJsonBuffer += input;
        const endIdx = toolCallJsonBuffer.indexOf('</tool_call>');
        if (endIdx !== -1) {
          const jsonStr = toolCallJsonBuffer.slice(0, endIdx);
          tagMode = 'normal';
          const after = toolCallJsonBuffer.slice(endIdx + 12);
          toolCallJsonBuffer = '';
          emitToolCallFromText(jsonStr.trim());
          if (after) processTextToken(after);
        }
        return;
      }

      // Normal mode — strip orphaned </think> (thinking started in a prior chunk)
      let text = input;
      const orphanIdx = text.indexOf('</think>');
      if (orphanIdx !== -1) {
        const before = text.slice(0, orphanIdx);
        const after = text.slice(orphanIdx + 8);
        text = before + after;
      }

      // Check for <think> opening
      const thinkIdx = text.indexOf('<think>');
      if (thinkIdx !== -1) {
        const before = text.slice(0, thinkIdx);
        if (before) emitTextDelta(before);
        tagMode = 'think';
        thinkBuffer = '';
        const after = text.slice(thinkIdx + 7);
        if (after) processTextToken(after);
        return;
      }

      // Check for <tool_call> opening
      const toolIdx = text.indexOf('<tool_call>');
      if (toolIdx !== -1) {
        const before = text.slice(0, toolIdx);
        if (before) emitTextDelta(before);
        tagMode = 'tool_call';
        toolCallJsonBuffer = '';
        const after = text.slice(toolIdx + 11);
        if (after) processTextToken(after);
        return;
      }

      // Check for partial tag at end (< that could be start of a known tag)
      const lastLt = text.lastIndexOf('<');
      if (lastLt !== -1 && lastLt >= text.length - 12) {
        const tail = text.slice(lastLt);
        if ('<think>'.startsWith(tail) || '</think>'.startsWith(tail) ||
            '<tool_call>'.startsWith(tail) || '</tool_call>'.startsWith(tail)) {
          const safe = text.slice(0, lastLt);
          if (safe) emitTextDelta(safe);
          pendingChars = tail;
          return;
        }
      }

      if (text) emitTextDelta(text);
    }

    // Build the partial AssistantMessage-like object for events
    const partialContent: unknown[] = [];
    const partial = {
      role: 'assistant' as const,
      content: partialContent,
      api: 'custom' as const,
      provider: 'cerebro' as const,
      model: 'cerebro',
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: 'stop' as const,
      timestamp: Date.now(),
    };

    // Emit start
    stream.push({ type: 'start', partial: partial as any });

    res.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const dataStr = trimmed.slice(6);

        let event: BackendChatStreamEvent;
        try {
          event = JSON.parse(dataStr);
        } catch {
          continue;
        }

        // Handle text tokens (with <think>/<tool_call> tag interception)
        if (event.token) {
          processTextToken(event.token);
        }

        // Handle tool calls
        if (event.tool_calls && event.tool_calls.length > 0) {
          // Close text block if open
          if (accumulatedText !== '') {
            stream.push({ type: 'text_end', contentIndex, content: accumulatedText, partial: partial as any });
            contentIndex++;
            accumulatedText = '';
          }

          for (const tc of event.tool_calls) {
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(tc.arguments || '{}');
            } catch {
              // leave empty
            }
            const toolCall = {
              type: 'toolCall' as const,
              id: tc.id,
              name: tc.name,
              arguments: args,
            };
            partialContent.push(toolCall);
            stream.push({ type: 'toolcall_start', contentIndex, partial: partial as any });
            stream.push({ type: 'toolcall_delta', contentIndex, delta: tc.arguments || '{}', partial: partial as any });
            stream.push({ type: 'toolcall_end', contentIndex, toolCall, partial: partial as any });
            contentIndex++;
            toolCallIndex++;
          }
        }

        // Handle done
        if (event.done) {
          streamDone = true;
          flushPending();
          // Close text block if still open
          if (accumulatedText !== '') {
            stream.push({ type: 'text_end', contentIndex, content: accumulatedText, partial: partial as any });
          }

          if (event.finish_reason === 'error') {
            const errorMsg = (event.usage as any)?.error || 'Request failed';
            emitError(stream, errorMsg);
            return;
          }

          const hasToolCalls = toolCallIndex > 0;
          const stopReason = hasToolCalls ? 'toolUse' : 'stop';
          partial.stopReason = stopReason as any;

          stream.push({
            type: 'done',
            reason: stopReason as any,
            message: partial as any,
          });
          return;
        }
      }
    });

    res.on('end', () => {
      // Only emit done if the SSE data handler didn't already
      if (streamDone) return;
      flushPending();
      if (accumulatedText !== '') {
        stream.push({ type: 'text_end', contentIndex, content: accumulatedText, partial: partial as any });
      }
      stream.push({ type: 'done', reason: 'stop' as any, message: partial as any });
    });

    res.on('error', (err) => {
      emitError(stream, err.message);
    });
  });

  req.on('error', (err) => {
    handleError(err as Error & { statusCode?: number });
  });

  // Handle abort
  if (signal) {
    signal.addEventListener('abort', () => {
      req.destroy();
    });
  }

  req.write(bodyStr);
  req.end();
}

function emitError(stream: AssistantMessageEventStream, message: string): void {
  const errorPartial = {
    role: 'assistant' as const,
    content: [],
    api: 'custom' as const,
    provider: 'cerebro' as const,
    model: 'cerebro',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'error' as const,
    errorMessage: message,
    timestamp: Date.now(),
  };
  stream.push({ type: 'error', reason: 'error' as any, error: errorPartial as any });
}
