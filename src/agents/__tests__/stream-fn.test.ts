import { describe, it, expect } from 'vitest';
import { repairJson, fuzzyMatchToolName } from '../stream-fn';

describe('repairJson', () => {
  it('fixes unquoted keys', () => {
    const result = repairJson('{name: "test", value: 42}');
    expect(JSON.parse(result)).toEqual({ name: 'test', value: 42 });
  });

  it('removes trailing commas', () => {
    const result = repairJson('{"a": 1, "b": 2,}');
    expect(JSON.parse(result)).toEqual({ a: 1, b: 2 });
  });

  it('removes trailing commas in arrays', () => {
    const result = repairJson('[1, 2, 3,]');
    expect(JSON.parse(result)).toEqual([1, 2, 3]);
  });

  it('closes unclosed braces', () => {
    const result = repairJson('{"key": "value"');
    expect(JSON.parse(result)).toEqual({ key: 'value' });
  });

  it('closes unclosed brackets', () => {
    const result = repairJson('[1, 2, 3');
    expect(JSON.parse(result)).toEqual([1, 2, 3]);
  });

  it('closes multiple unclosed brackets/braces', () => {
    const result = repairJson('{"arr": [1, 2');
    expect(JSON.parse(result)).toEqual({ arr: [1, 2] });
  });

  it('fixes single-quoted strings at structural boundaries', () => {
    const result = repairJson("{'name': 'test'}");
    expect(JSON.parse(result)).toEqual({ name: 'test' });
  });

  it('preserves apostrophes in values (O\'Brien edge case)', () => {
    // Input is valid JSON with an apostrophe in a value — should not corrupt it
    const valid = '{"name": "O\'Brien"}';
    const result = repairJson(valid);
    expect(JSON.parse(result)).toEqual({ name: "O'Brien" });
  });

  it('passes through valid JSON unchanged', () => {
    const valid = '{"key": "value", "num": 42}';
    const result = repairJson(valid);
    expect(result.trim()).toBe(valid);
  });

  it('handles combined issues: unquoted keys + unclosed brace', () => {
    const result = repairJson('{name: "test", value: 42');
    expect(JSON.parse(result)).toEqual({ name: 'test', value: 42 });
  });

  it('handles combined issues: unquoted keys + trailing comma', () => {
    const result = repairJson('{name: "test", value: 42,}');
    expect(JSON.parse(result)).toEqual({ name: 'test', value: 42 });
  });
});

describe('fuzzyMatchToolName', () => {
  const toolNames = ['web_search', 'delegate_to_expert', 'propose_expert', 'list_experts'];

  it('returns exact match', () => {
    expect(fuzzyMatchToolName('web_search', toolNames)).toBe('web_search');
  });

  it('matches with normalized comparison (case + special chars)', () => {
    expect(fuzzyMatchToolName('Web_Search', toolNames)).toBe('web_search');
    expect(fuzzyMatchToolName('web-search', toolNames)).toBe('web_search');
  });

  it('returns prefix match', () => {
    expect(fuzzyMatchToolName('delegate', toolNames)).toBe('delegate_to_expert');
  });

  it('returns original name when no match found', () => {
    expect(fuzzyMatchToolName('nonexistent_tool', toolNames)).toBe('nonexistent_tool');
  });

  it('returns original name for empty tool list', () => {
    expect(fuzzyMatchToolName('web_search', [])).toBe('web_search');
  });

  it('handles reverse prefix match (tool name is prefix of input)', () => {
    // If the input starts with a known tool name prefix
    expect(fuzzyMatchToolName('web_search_v2', toolNames)).toBe('web_search');
  });
});
