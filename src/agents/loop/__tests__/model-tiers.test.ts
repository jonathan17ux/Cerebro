import { describe, it, expect } from 'vitest';
import { classifyModelTier, getTierConfig, getTierGuidance } from '../model-tiers';
import type { ResolvedModel } from '../../types';

function model(overrides: Partial<ResolvedModel>): ResolvedModel {
  return {
    source: 'local',
    modelId: 'test-model',
    displayName: 'Test Model',
    ...overrides,
  };
}

describe('classifyModelTier', () => {
  it('classifies cloud providers as large', () => {
    expect(classifyModelTier(model({ source: 'cloud', provider: 'anthropic', modelId: 'claude-3-haiku' }))).toBe('large');
    expect(classifyModelTier(model({ source: 'cloud', provider: 'openai', modelId: 'gpt-4o-mini' }))).toBe('large');
    expect(classifyModelTier(model({ source: 'cloud', provider: 'google', modelId: 'gemini-flash' }))).toBe('large');
  });

  it('classifies small local models (1b-8b)', () => {
    expect(classifyModelTier(model({ modelId: 'gemma-3-4b-instruct' }))).toBe('small');
    expect(classifyModelTier(model({ modelId: 'qwen2-7b-instruct' }))).toBe('small');
    expect(classifyModelTier(model({ modelId: 'llama-3.2-1b' }))).toBe('small');
    expect(classifyModelTier(model({ modelId: 'phi-3-mini-3b' }))).toBe('small');
  });

  it('classifies medium local models (12b-35b)', () => {
    expect(classifyModelTier(model({ modelId: 'gemma-3-12b-instruct' }))).toBe('medium');
    expect(classifyModelTier(model({ modelId: 'qwen3.5-35b-a3b' }))).toBe('medium');
    expect(classifyModelTier(model({ modelId: 'llama-3-13b' }))).toBe('medium');
    expect(classifyModelTier(model({ modelId: 'mistral-27b-instruct' }))).toBe('medium');
  });

  it('classifies large local models (40b+)', () => {
    expect(classifyModelTier(model({ modelId: 'llama-3-70b' }))).toBe('large');
  });

  it('defaults unknown local models to medium', () => {
    expect(classifyModelTier(model({ modelId: 'custom-model-v2' }))).toBe('medium');
    expect(classifyModelTier(model({ modelId: 'my-fine-tuned' }))).toBe('medium');
  });
});

describe('getTierConfig', () => {
  it('returns different maxTurns per tier', () => {
    expect(getTierConfig('small').maxTurns).toBeLessThan(getTierConfig('medium').maxTurns);
    expect(getTierConfig('medium').maxTurns).toBeLessThan(getTierConfig('large').maxTurns);
  });

  it('returns different context budgets per tier', () => {
    expect(getTierConfig('small').contextBudget).toBeLessThan(getTierConfig('large').contextBudget);
  });
});

describe('getTierGuidance', () => {
  it('returns step-by-step guidance for small models', () => {
    const guidance = getTierGuidance('small');
    expect(guidance).toContain('step by step');
    expect(guidance).toContain('ONE tool');
  });

  it('returns brief guidance for medium models', () => {
    const guidance = getTierGuidance('medium');
    expect(guidance).toBeTruthy();
    expect(guidance.length).toBeLessThan(getTierGuidance('small').length);
  });

  it('returns empty string for large models', () => {
    expect(getTierGuidance('large')).toBe('');
  });
});
