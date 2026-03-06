import { describe, it, expect } from 'vitest';
import { createContextTransform } from '../context-manager';
import type { TierConfig } from '../model-tiers';

const smallConfig: TierConfig = {
  maxTurns: 5,
  contextBudget: 100,  // Very low for testing (~400 chars)
  compressionThreshold: 200,
  loopThreshold: 2,
  assistantTruncation: 150,
};

const largeConfig: TierConfig = {
  maxTurns: 15,
  contextBudget: 100_000,  // Very high — should pass through
  compressionThreshold: 8000,
  loopThreshold: 3,
  assistantTruncation: 800,
};

function userMsg(text: string) {
  return { role: 'user', content: text, timestamp: Date.now() };
}

function assistantMsg(text: string) {
  return { role: 'assistant', content: [{ type: 'text', text }], timestamp: Date.now() };
}

function toolResult(text: string, toolName = 'test_tool') {
  return {
    role: 'toolResult',
    toolCallId: 'tc_1',
    toolName,
    content: [{ type: 'text', text }],
    isError: false,
    timestamp: Date.now(),
  };
}

describe('createContextTransform', () => {
  it('passes through messages under budget', async () => {
    const transform = createContextTransform(largeConfig);
    const messages = [userMsg('hello'), assistantMsg('hi')];
    const result = await transform(messages);
    expect(result).toEqual(messages);
  });

  it('prunes messages when over budget', async () => {
    const transform = createContextTransform(smallConfig);
    const messages = [
      userMsg('first question'),
      assistantMsg('a'.repeat(300)),
      toolResult('b'.repeat(300)),
      userMsg('second question'),
      assistantMsg('c'.repeat(300)),
    ];
    const result = await transform(messages);

    // Result should be smaller than input
    const inputLen = JSON.stringify(messages).length;
    const outputLen = JSON.stringify(result).length;
    expect(outputLen).toBeLessThan(inputLen);
  });

  it('preserves the first user message', async () => {
    const transform = createContextTransform(smallConfig);
    const first = userMsg('important first question');
    const messages = [
      first,
      assistantMsg('a'.repeat(300)),
      toolResult('b'.repeat(300)),
      userMsg('latest question'),
      assistantMsg('latest answer'),
    ];
    const result = await transform(messages);

    // First user message should still be present
    const hasFirst = result.some(
      (m: any) => m.role === 'user' && m.content === 'important first question',
    );
    expect(hasFirst).toBe(true);
  });

  it('preserves the last turn', async () => {
    const transform = createContextTransform(smallConfig);
    const messages = [
      userMsg('old question'),
      assistantMsg('a'.repeat(500)),
      userMsg('latest question'),
      assistantMsg('latest answer'),
    ];
    const result = await transform(messages);

    // Last user + assistant should be preserved
    const lastUser = result.find(
      (m: any) => m.role === 'user' && (typeof m.content === 'string' ? m.content : '') === 'latest question',
    );
    expect(lastUser).toBeTruthy();
  });

  it('truncates old tool results in phase 1', async () => {
    // Budget of 50 tokens = ~200 chars; tool result alone is 2000 chars (~500 tokens)
    const config: TierConfig = { ...smallConfig, contextBudget: 50 };
    const transform = createContextTransform(config);
    const longResult = 'x'.repeat(2000);
    const messages = [
      userMsg('q1'),
      toolResult(longResult, 'big_tool'),
      userMsg('q2'),
      assistantMsg('short'),
    ];
    const result = await transform(messages);

    // Result should be smaller than input overall (pruning happened)
    const inputLen = JSON.stringify(messages).length;
    const outputLen = JSON.stringify(result).length;
    expect(outputLen).toBeLessThan(inputLen);
  });
});
