import { describe, it, expect } from 'vitest';
import { selectStrategySmall, distillContext } from '../delegation-tools';

// Minimal team record for testing
function makeTeam(members: Array<{ role: string; expert_id?: string; order?: number }>, strategy?: string) {
  return {
    id: 'team-1',
    name: 'Test Team',
    domain: null,
    description: 'Test team',
    type: 'team' as const,
    is_enabled: true,
    strategy: strategy ?? null,
    coordinator_prompt: null,
    team_members: members.map((m, i) => ({
      expert_id: m.expert_id ?? `expert-${i}`,
      role: m.role,
      order: m.order ?? i,
      delegation_prompt: null,
      on_error: 'skip',
    })),
  };
}

describe('selectStrategySmall', () => {
  it('selects parallel for parallel keywords', () => {
    // Use non-pipeline roles so sequential role-boost doesn't interfere
    const team = makeTeam([{ role: 'analyst' }, { role: 'strategist' }]);
    expect(selectStrategySmall(team, 'analyze these topics simultaneously')).toBe('parallel');
    expect(selectStrategySmall(team, 'get different perspectives on this')).toBe('parallel');
    expect(selectStrategySmall(team, 'compare these approaches independently')).toBe('parallel');
  });

  it('selects sequential for sequential keywords', () => {
    const team = makeTeam([{ role: 'writer' }, { role: 'editor' }]);
    expect(selectStrategySmall(team, 'write a draft then review it')).toBe('sequential');
    expect(selectStrategySmall(team, 'draft this step by step and refine')).toBe('sequential');
    expect(selectStrategySmall(team, 'create first, then critique and polish')).toBe('sequential');
  });

  it('boosts parallel when all members share the same role', () => {
    const team = makeTeam([{ role: 'researcher' }, { role: 'researcher' }, { role: 'researcher' }]);
    // No keywords at all — same-role boost (+2) should tip to parallel
    expect(selectStrategySmall(team, 'analyze this topic')).toBe('parallel');
  });

  it('boosts sequential for pipeline roles (reviewer, editor, critic)', () => {
    const team = makeTeam([{ role: 'writer' }, { role: 'reviewer' }]);
    // No keywords at all — pipeline role boost (+2) should tip to sequential
    expect(selectStrategySmall(team, 'write about this topic')).toBe('sequential');
  });

  it('defaults to parallel when ambiguous (no keywords, no role signals)', () => {
    const team = makeTeam([{ role: 'analyst' }, { role: 'strategist' }]);
    expect(selectStrategySmall(team, 'think about this problem')).toBe('parallel');
  });
});

describe('distillContext', () => {
  it('passes through short responses unchanged', () => {
    const result = distillContext('', 'writer', 'Short answer.', 'small');
    expect(result).toContain('Short answer.');
    expect(result).toContain('[writer output]');
  });

  it('truncates at sentence boundary for small tier', () => {
    const longText = 'First sentence. Second sentence. Third sentence. ' + 'x'.repeat(500);
    const result = distillContext('', 'writer', longText, 'small');
    expect(result.length).toBeLessThan(longText.length + 50); // includes label overhead
    expect(result).toContain('(truncated)');
  });

  it('uses head+tail split for medium tier', () => {
    const longText = 'Start of response. ' + 'x'.repeat(2000) + ' End of response.';
    const result = distillContext('', 'writer', longText, 'medium');
    expect(result).toContain('Start of response');
    expect(result).toContain('End of response');
    expect(result).toContain('(middle omitted)');
  });

  it('uses head+tail split for large tier with larger budget', () => {
    const longText = 'Beginning. ' + 'x'.repeat(4000) + ' Conclusion.';
    const result = distillContext('', 'writer', longText, 'large');
    expect(result).toContain('Beginning');
    expect(result).toContain('Conclusion');
    expect(result).toContain('(middle omitted)');
  });

  it('chains previous context', () => {
    const prev = '[researcher output]:\nSome findings.';
    const result = distillContext(prev, 'writer', 'My draft.', 'medium');
    expect(result).toContain('[researcher output]');
    expect(result).toContain('[writer output]');
    expect(result).toContain('My draft.');
  });

  it('does not truncate responses under the limit', () => {
    const shortText = 'A brief response.';
    const result = distillContext('', 'analyst', shortText, 'small');
    expect(result).not.toContain('truncated');
    expect(result).not.toContain('omitted');
    expect(result).toContain('A brief response.');
  });
});
