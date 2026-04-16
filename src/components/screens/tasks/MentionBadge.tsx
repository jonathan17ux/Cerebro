import { AtSign } from 'lucide-react';
import clsx from 'clsx';
import type { Components } from 'react-markdown';

interface MentionBadgeProps {
  expertId: string;
  name: string;
}

const PALETTE = [
  'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
  'bg-purple-500/15 text-purple-400 border-purple-500/30',
  'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  'bg-amber-500/15 text-amber-400 border-amber-500/30',
  'bg-pink-500/15 text-pink-400 border-pink-500/30',
  'bg-indigo-500/15 text-indigo-400 border-indigo-500/30',
  'bg-teal-500/15 text-teal-400 border-teal-500/30',
  'bg-rose-500/15 text-rose-400 border-rose-500/30',
];

function hashIndex(id: string, modulo: number): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % modulo;
}

export default function MentionBadge({ expertId, name }: MentionBadgeProps) {
  const color = PALETTE[hashIndex(expertId, PALETTE.length)];
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-medium border align-baseline',
        color,
      )}
    >
      <AtSign size={10} />
      {name}
    </span>
  );
}

export const mentionMarkdownComponents: Components = {
  a: ({ href, children, ...rest }) => {
    if (typeof href === 'string' && href.startsWith('expert:')) {
      const expertId = href.slice('expert:'.length);
      const name = Array.isArray(children)
        ? children.map((c) => (typeof c === 'string' ? c : '')).join('')
        : typeof children === 'string'
          ? children
          : '';
      return <MentionBadge expertId={expertId} name={name || expertId} />;
    }
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  },
};
