/**
 * Translates pi-agent-core AgentEvents to RendererAgentEvents for the UI.
 */

import type { AgentEvent } from '@mariozechner/pi-agent-core';
import type { RendererAgentEvent } from './types';

/**
 * Translate a pi-agent-core event to one or more RendererAgentEvents.
 * Returns null for events we don't need to forward.
 */
export function translateEvent(
  event: AgentEvent,
  runId: string,
  turnCount: { value: number },
): RendererAgentEvent | null {
  switch (event.type) {
    case 'turn_start':
      turnCount.value++;
      return { type: 'turn_start', turn: turnCount.value };

    case 'message_update': {
      const ame = event.assistantMessageEvent;
      if (ame.type === 'text_delta') {
        return { type: 'text_delta', delta: ame.delta };
      }
      // Other message updates (text_start, text_end, toolcall events) are handled
      // at a higher level by the runtime
      return null;
    }

    case 'tool_execution_start':
      return {
        type: 'tool_start',
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.args,
      };

    case 'tool_execution_end': {
      const resultText =
        event.result?.content
          ?.filter((c: any) => c.type === 'text')
          .map((c: any) => c.text)
          .join('\n') || '';
      return {
        type: 'tool_end',
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        result: resultText,
        isError: event.isError,
      };
    }

    case 'agent_end': {
      // Extract accumulated text from the last assistant message
      const messages = event.messages || [];
      let lastContent = '';
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i] as any;
        if (msg.role === 'assistant') {
          if (Array.isArray(msg.content)) {
            lastContent = msg.content
              .filter((c: any) => c.type === 'text')
              .map((c: any) => c.text)
              .join('');
          } else if (typeof msg.content === 'string') {
            lastContent = msg.content;
          }
          break;
        }
      }
      return { type: 'done', runId, messageContent: lastContent };
    }

    default:
      return null;
  }
}
