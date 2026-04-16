import type { Expert } from '../context/ExpertContext';

export interface ResolvedMention {
  expertId: string;
  name: string;
  startIndex: number;
  endIndex: number;
  raw: string;
}

export const MENTION_TOKEN_RE = /@\[([^\]]+)\]\(expert:([^)]+)\)/g;

export function formatMentionToken(expertId: string, name: string): string {
  return `@[${name}](expert:${expertId})`;
}

function isMentionBoundary(prevChar: string | undefined): boolean {
  return prevChar === undefined || /\s/.test(prevChar);
}

export function resolveMentions(body: string, experts: Expert[]): ResolvedMention[] {
  if (!body) return [];

  const covered: Array<[number, number]> = [];
  const results: ResolvedMention[] = [];

  for (const match of body.matchAll(MENTION_TOKEN_RE)) {
    const [raw, name, expertId] = match;
    const startIndex = match.index ?? 0;
    const endIndex = startIndex + raw.length;
    results.push({ expertId, name, startIndex, endIndex, raw });
    covered.push([startIndex, endIndex]);
  }

  const sortedExperts = [...experts].sort((a, b) => b.name.length - a.name.length);
  const lowerBody = body.toLowerCase();

  for (let i = 0; i < body.length; i++) {
    if (body[i] !== '@') continue;
    if (!isMentionBoundary(body[i - 1])) continue;
    if (covered.some(([s, e]) => i >= s && i < e)) continue;

    for (const expert of sortedExperts) {
      const lowerName = expert.name.toLowerCase();
      if (lowerName.length === 0) continue;
      const candidateEnd = i + 1 + lowerName.length;
      if (candidateEnd > body.length) continue;
      if (lowerBody.slice(i + 1, candidateEnd) !== lowerName) continue;
      const after = body[candidateEnd];
      if (after !== undefined && /[A-Za-z0-9]/.test(after)) continue;

      results.push({
        expertId: expert.id,
        name: expert.name,
        startIndex: i,
        endIndex: candidateEnd,
        raw: body.slice(i, candidateEnd),
      });
      covered.push([i, candidateEnd]);
      break;
    }
  }

  return results.sort((a, b) => a.startIndex - b.startIndex);
}

export function extractMentionIds(body: string, experts: Expert[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const m of resolveMentions(body, experts)) {
    if (!seen.has(m.expertId)) {
      seen.add(m.expertId);
      ids.push(m.expertId);
    }
  }
  return ids;
}

export function stripMentionSyntax(body: string, experts: Expert[]): string {
  if (!body) return body;
  const mentions = resolveMentions(body, experts);
  if (mentions.length === 0) return body;

  const parts: string[] = [];
  let cursor = 0;
  for (const m of mentions) {
    parts.push(body.slice(cursor, m.startIndex));
    parts.push(`@${m.name}`);
    cursor = m.endIndex;
  }
  parts.push(body.slice(cursor));
  return parts.join('');
}

export function normalizeToTokens(body: string, experts: Expert[]): string {
  if (!body) return body;
  const mentions = resolveMentions(body, experts);
  if (mentions.length === 0) return body;

  const parts: string[] = [];
  let cursor = 0;
  for (const m of mentions) {
    parts.push(body.slice(cursor, m.startIndex));
    parts.push(formatMentionToken(m.expertId, m.name));
    cursor = m.endIndex;
  }
  parts.push(body.slice(cursor));
  return parts.join('');
}
