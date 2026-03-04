/**
 * Shared utilities for agent tools.
 */

import http from 'node:http';
import type { AgentToolResult } from '@mariozechner/pi-agent-core';

/**
 * Make an HTTP request to the local backend.
 */
export function backendRequest<T>(port: number, method: string, path: string, body?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : undefined;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (bodyStr) headers['Content-Length'] = Buffer.byteLength(bodyStr).toString();

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers,
        timeout: 30_000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data) as T);
          } catch {
            resolve(data as T);
          }
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

/**
 * Create a simple text tool result.
 */
export function textResult(text: string): AgentToolResult<void> {
  return { content: [{ type: 'text', text }], details: undefined as any };
}
