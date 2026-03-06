import { describe, it, expect, vi } from 'vitest';
import { wrapTools } from '../tool-wrapper';
import type { TierConfig } from '../model-tiers';

const testConfig: TierConfig = {
  maxTurns: 5,
  contextBudget: 4000,
  compressionThreshold: 100,  // Low threshold for testing compression
  loopThreshold: 2,
  assistantTruncation: 150,
};

function makeTool(name: string, executeFn: (...args: any[]) => Promise<any>) {
  return {
    name,
    label: name,
    description: `Test tool: ${name}`,
    parameters: { type: 'object', properties: {} },
    execute: executeFn,
  } as any;
}

function textResult(text: string) {
  return { content: [{ type: 'text', text }], details: undefined };
}

describe('wrapTools', () => {
  it('returns cached result for identical calls', async () => {
    const executeSpy = vi.fn().mockResolvedValue(textResult('search result'));
    const tools = wrapTools([makeTool('web_search', executeSpy)], testConfig);
    const tool = tools[0];

    // First call
    const result1 = await tool.execute('tc1', { query: 'test' });
    expect(executeSpy).toHaveBeenCalledTimes(1);

    // Second identical call — should return cached
    const result2 = await tool.execute('tc2', { query: 'test' });
    expect(executeSpy).toHaveBeenCalledTimes(1); // NOT called again
    expect(result2.content[0].text).toContain('cached result');
    expect(result2.content[0].text).toContain('search result');
  });

  it('does not cache calls with different args', async () => {
    const executeSpy = vi.fn().mockResolvedValue(textResult('result'));
    const tools = wrapTools([makeTool('web_search', executeSpy)], testConfig);
    const tool = tools[0];

    await tool.execute('tc1', { query: 'test1' });
    await tool.execute('tc2', { query: 'test2' });
    expect(executeSpy).toHaveBeenCalledTimes(2);
  });

  it('enriches errors with actionable guidance', async () => {
    const executeSpy = vi.fn().mockRejectedValue(new Error('Resource not found (404)'));
    const tools = wrapTools([makeTool('fetch_data', executeSpy)], testConfig);
    const tool = tools[0];

    const result = await tool.execute('tc1', { id: '123' });
    expect(result.content[0].text).toContain('fetch_data');
    expect(result.content[0].text).toContain('not found');
    expect(result.content[0].text).toContain('different approach');
  });

  it('enriches timeout errors', async () => {
    const executeSpy = vi.fn().mockRejectedValue(new Error('ETIMEDOUT'));
    const tools = wrapTools([makeTool('slow_tool', executeSpy)], testConfig);
    const tool = tools[0];

    const result = await tool.execute('tc1', {});
    expect(result.content[0].text).toContain('timed out');
    expect(result.content[0].text).toContain('retry');
  });

  it('compresses results exceeding threshold', async () => {
    const longText = 'x'.repeat(500);
    const executeSpy = vi.fn().mockResolvedValue(textResult(longText));
    const tools = wrapTools([makeTool('verbose_tool', executeSpy)], testConfig);
    const tool = tools[0];

    const result = await tool.execute('tc1', {});
    const text = result.content[0].text;
    expect(text.length).toBeLessThan(longText.length);
    expect(text).toContain('truncated');
  });

  it('does not compress results under threshold', async () => {
    const shortText = 'short result';
    const executeSpy = vi.fn().mockResolvedValue(textResult(shortText));
    const tools = wrapTools([makeTool('small_tool', executeSpy)], testConfig);
    const tool = tools[0];

    const result = await tool.execute('tc1', {});
    expect(result.content[0].text).toBe(shortText);
  });
});
