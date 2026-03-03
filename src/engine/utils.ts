/**
 * Shared utilities for the execution engine.
 */

/**
 * Parse a dot-path like "data.events[0].title" into segments.
 * Returns array of string keys and number indices.
 *
 * Examples:
 *   "user.profile.name"  → ["user", "profile", "name"]
 *   "events[0].title"    → ["events", 0, "title"]
 *   "matrix[1][0]"       → ["matrix", 1, 0]
 */
export function parsePath(path: string): Array<string | number> {
  const segments: Array<string | number> = [];
  const re = /([^.[]+)|\[(\d+)\]/g;
  let match: RegExpExecArray | null;

  while ((match = re.exec(path)) !== null) {
    if (match[1] !== undefined) {
      segments.push(match[1]);
    } else if (match[2] !== undefined) {
      segments.push(parseInt(match[2], 10));
    }
  }

  return segments;
}

/**
 * Extract a value from nested data using a dot-path.
 * Returns undefined for missing or invalid paths.
 */
export function extractByPath(data: unknown, path: string): unknown {
  if (!path) return data;

  const segments = parsePath(path);
  let current: unknown = data;

  for (const segment of segments) {
    if (current === null || current === undefined) return undefined;

    if (typeof segment === 'number') {
      if (!Array.isArray(current)) return undefined;
      current = current[segment];
    } else {
      if (typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[segment];
    }
  }

  return current;
}
