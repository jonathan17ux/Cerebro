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
          if (res.statusCode && res.statusCode >= 400) {
            let detail = `HTTP ${res.statusCode}`;
            try {
              const parsed = JSON.parse(data);
              if (parsed.detail) detail = parsed.detail;
            } catch { /* use status code */ }
            reject(new Error(detail));
            return;
          }
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

/**
 * Fuzzy name similarity check — returns true if names are close enough
 * to be considered duplicates. Uses token-based Jaccard overlap to avoid
 * false positives with short names (e.g. "AI" matching "AI Email Draft").
 */
export function isSimilarName(a: string, b: string): boolean {
  const tokenize = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(Boolean);
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.length === 0 || tb.length === 0) return false;

  // Exact match after normalization
  if (ta.join(' ') === tb.join(' ')) return true;

  // Jaccard similarity — require >60% token overlap
  const setA = new Set(ta);
  const setB = new Set(tb);
  let intersection = 0;
  for (const t of setA) {
    if (setB.has(t)) intersection++;
  }
  const union = new Set([...ta, ...tb]).size;
  return intersection / union > 0.6;
}
