import { describe, it, expect } from 'vitest';
import { TaskStreamParser, type TaskStreamEvent } from './stream-parser';

// Helper: feed a string in small random-ish chunks to exercise the buffering
function feedChunked(parser: TaskStreamParser, text: string, chunkSize = 7): TaskStreamEvent[] {
  const events: TaskStreamEvent[] = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    events.push(...parser.feed(text.slice(i, i + chunkSize)));
  }
  return events;
}

// ── Clarify mode ────────────────────────────────────────────────

describe('TaskStreamParser (clarify)', () => {
  it('emits ready for <ready/>', () => {
    const p = new TaskStreamParser('clarify');
    const events = p.feed('<ready/>');
    expect(events).toEqual([{ type: 'ready' }]);
  });

  it('emits ready for <ready /> with space', () => {
    const p = new TaskStreamParser('clarify');
    const events = p.feed('<ready />');
    expect(events).toEqual([{ type: 'ready' }]);
  });

  it('emits ready on flush when no tag found', () => {
    const p = new TaskStreamParser('clarify');
    p.feed('Some thinking text...');
    const events = p.flush();
    expect(events).toEqual([{ type: 'ready' }]);
  });

  it('parses clarification questions', () => {
    const p = new TaskStreamParser('clarify');
    const json = JSON.stringify({
      questions: [
        { id: 'q1', kind: 'text', q: 'What style?', placeholder: 'e.g. modern' },
        { id: 'q2', kind: 'bool', q: 'Include dark mode?', default: true },
      ],
    });
    const events = p.feed(`<clarification>${json}</clarification>`);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('clarification');
    if (events[0].type === 'clarification') {
      expect(events[0].questions).toHaveLength(2);
      expect(events[0].questions[0].id).toBe('q1');
    }
  });

  it('handles chunked clarification', () => {
    const p = new TaskStreamParser('clarify');
    const json = JSON.stringify({
      questions: [{ id: 'q1', kind: 'select', q: 'Platform?', options: ['Web', 'Mobile'] }],
    });
    const full = `<clarification>${json}</clarification>`;
    const events = feedChunked(p, full, 10);
    expect(events.some((e) => e.type === 'clarification')).toBe(true);
  });

  it('does not double-emit ready', () => {
    const p = new TaskStreamParser('clarify');
    p.feed('<ready/>');
    const events2 = p.feed('<ready/>');
    const flush = p.flush();
    expect(events2).toHaveLength(0);
    expect(flush).toHaveLength(0);
  });
});

// ── Execute mode ────────────────────────────────────────────────

describe('TaskStreamParser (execute)', () => {
  it('parses a plan block', () => {
    const p = new TaskStreamParser('execute');
    const planJson = JSON.stringify({
      phases: [
        { id: 'p1', name: 'Research', description: 'Do research', expert_slug: 'researcher-abc123', needs_new_expert: false },
        { id: 'p2', name: 'Write', description: 'Write spec', expert_slug: null, needs_new_expert: true, new_expert: { name: 'Writer', description: 'Writes', domain: 'content' } },
      ],
    });
    const events = p.feed(`<plan kind="markdown">${planJson}</plan>`);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('plan');
    if (events[0].type === 'plan') {
      expect(events[0].kind).toBe('markdown');
      expect(events[0].plan.phases).toHaveLength(2);
      expect(events[0].plan.phases[0].expert_slug).toBe('researcher-abc123');
      expect(events[0].plan.phases[1].needs_new_expert).toBe(true);
    }
  });

  it('parses phase lifecycle', () => {
    const p = new TaskStreamParser('execute');
    // Seed a plan so we have context
    const planJson = JSON.stringify({ phases: [{ id: 'p1', name: 'Research', description: 'Do research' }] });
    p.feed(`<plan kind="markdown">${planJson}</plan>`);

    const events: TaskStreamEvent[] = [];
    events.push(...p.feed('<phase id="p1" name="Research">'));
    events.push(...p.feed('...agent output...'));
    events.push(...p.feed('<phase_summary>Found 3 competitors</phase_summary>'));
    events.push(...p.feed('</phase>'));

    expect(events.find((e) => e.type === 'phase_start')).toEqual({
      type: 'phase_start',
      phaseId: 'p1',
      name: 'Research',
    });
    expect(events.find((e) => e.type === 'phase_summary')).toEqual({
      type: 'phase_summary',
      phaseId: 'p1',
      summary: 'Found 3 competitors',
    });
    expect(events.find((e) => e.type === 'phase_end')).toEqual({
      type: 'phase_end',
      phaseId: 'p1',
    });
  });

  it('parses multiple phases', () => {
    const p = new TaskStreamParser('execute');
    const planJson = JSON.stringify({ phases: [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }] });
    p.feed(`<plan kind="mixed">${planJson}</plan>`);

    const events: TaskStreamEvent[] = [];
    events.push(...p.feed('<phase id="p1" name="A">'));
    events.push(...p.feed('<phase_summary>Done A</phase_summary></phase>'));
    events.push(...p.feed('<phase id="p2" name="B">'));
    events.push(...p.feed('<phase_summary>Done B</phase_summary></phase>'));

    const starts = events.filter((e) => e.type === 'phase_start');
    const ends = events.filter((e) => e.type === 'phase_end');
    expect(starts).toHaveLength(2);
    expect(ends).toHaveLength(2);
  });

  it('parses deliverable block', () => {
    const p = new TaskStreamParser('execute');
    const md = '# Report\n\nHere is the report content.';
    const events = p.feed(`<deliverable kind="markdown" title="Research Report">${md}</deliverable>`);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('deliverable');
    if (events[0].type === 'deliverable') {
      expect(events[0].kind).toBe('markdown');
      expect(events[0].title).toBe('Research Report');
      expect(events[0].markdown).toBe(md);
    }
  });

  it('parses code_app deliverable + run_info', () => {
    const p = new TaskStreamParser('execute');
    const deliverable = '<deliverable kind="code_app" title="Pomodoro Timer"># Timer App\n\nA pomodoro timer.</deliverable>';
    const runInfo = JSON.stringify({
      preview_type: 'web',
      setup_commands: ['npm install'],
      start_command: 'npm run dev',
      preview_url_pattern: 'Local:\\s+(https?://\\S+)',
    });
    const full = `${deliverable}\n<run_info>${runInfo}</run_info>`;

    const events = feedChunked(p, full, 15);
    const deliverableEvt = events.find((e) => e.type === 'deliverable');
    const runInfoEvt = events.find((e) => e.type === 'run_info');

    expect(deliverableEvt).toBeDefined();
    expect(runInfoEvt).toBeDefined();
    if (deliverableEvt?.type === 'deliverable') {
      expect(deliverableEvt.kind).toBe('code_app');
    }
    if (runInfoEvt?.type === 'run_info') {
      expect(runInfoEvt.info.preview_type).toBe('web');
      expect(runInfoEvt.info.setup_commands).toEqual(['npm install']);
    }
  });

  it('falls back to full buffer as deliverable on flush', () => {
    const p = new TaskStreamParser('execute');
    p.feed('Here is some untagged output from the LLM.');
    const events = p.flush();
    expect(events).toHaveLength(1);
    if (events[0].type === 'deliverable') {
      expect(events[0].kind).toBe('markdown');
      expect(events[0].markdown).toBe('Here is some untagged output from the LLM.');
    }
  });

  it('does not double-emit plan', () => {
    const p = new TaskStreamParser('execute');
    const planJson = JSON.stringify({ phases: [{ id: 'p1', name: 'A' }] });
    p.feed(`<plan kind="markdown">${planJson}</plan>`);
    const events2 = p.feed(`<plan kind="markdown">${planJson}</plan>`);
    expect(events2.filter((e) => e.type === 'plan')).toHaveLength(0);
  });

  it('handles deliverable without title attribute', () => {
    const p = new TaskStreamParser('execute');
    const events = p.feed('<deliverable kind="markdown">Some markdown</deliverable>');
    expect(events).toHaveLength(1);
    if (events[0].type === 'deliverable') {
      expect(events[0].title).toBeNull();
    }
  });

  it('getCurrentPhaseId tracks the active phase', () => {
    const p = new TaskStreamParser('execute');
    expect(p.getCurrentPhaseId()).toBeNull();
    p.feed('<phase id="p1" name="Test">');
    expect(p.getCurrentPhaseId()).toBe('p1');
    p.feed('</phase>');
    expect(p.getCurrentPhaseId()).toBeNull();
  });

  it('parses a full end-to-end execute stream', () => {
    const p = new TaskStreamParser('execute');
    const stream = [
      `<plan kind="code_app">${JSON.stringify({
        phases: [
          { id: 'p1', name: 'Scaffold', description: 'Create project', expert_slug: 'eng-abc123' },
          { id: 'p2', name: 'Implement', description: 'Build features', expert_slug: 'eng-abc123' },
        ],
      })}</plan>`,
      '<phase id="p1" name="Scaffold">',
      '...tool calls...',
      '<phase_summary>Project scaffolded with Vite + React</phase_summary>',
      '</phase>',
      '<phase id="p2" name="Implement">',
      '...more tool calls...',
      '<phase_summary>All features implemented</phase_summary>',
      '</phase>',
      '<deliverable kind="code_app" title="Timer App"># Timer\n\nBuilt with Vite.</deliverable>',
      `<run_info>${JSON.stringify({
        preview_type: 'web',
        setup_commands: ['npm install'],
        start_command: 'npm run dev',
        preview_url_pattern: 'Local:\\s+(https?://\\S+)',
      })}</run_info>`,
    ];

    const events: TaskStreamEvent[] = [];
    for (const chunk of stream) {
      events.push(...p.feed(chunk));
    }

    const types = events.map((e) => e.type);
    expect(types).toEqual([
      'plan',
      'phase_start',
      'phase_summary',
      'phase_end',
      'phase_start',
      'phase_summary',
      'phase_end',
      'deliverable',
      'run_info',
    ]);
  });
});
