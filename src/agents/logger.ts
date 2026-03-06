/**
 * Structured logger for the Cerebro agent system.
 *
 * Produces `[Agent:runId]` prefixed log lines matching existing
 * `[Cerebro]` / `[Python]` conventions. Debug output is gated
 * behind the `CEREBRO_DEBUG` environment variable.
 */

const isDebug = !!process.env.CEREBRO_DEBUG;

export interface AgentLogger {
  debug(msg: string, ctx?: Record<string, unknown>): void;
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
}

function formatCtx(ctx?: Record<string, unknown>): string {
  if (!ctx || Object.keys(ctx).length === 0) return '';
  const parts = Object.entries(ctx)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' ');
  return ` ${parts}`;
}

/**
 * Create a logger scoped to a specific agent run.
 */
export function createAgentLogger(runId: string): AgentLogger {
  const prefix = `[Agent:${runId.slice(0, 8)}]`;

  return {
    debug(msg, ctx) {
      if (isDebug) console.debug(`${prefix} ${msg}${formatCtx(ctx)}`);
    },
    info(msg, ctx) {
      console.log(`${prefix} ${msg}${formatCtx(ctx)}`);
    },
    warn(msg, ctx) {
      console.warn(`${prefix} ${msg}${formatCtx(ctx)}`);
    },
    error(msg, ctx) {
      console.error(`${prefix} ${msg}${formatCtx(ctx)}`);
    },
  };
}
