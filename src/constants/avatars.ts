const avatarUrls = import.meta.glob<string>('../assets/avatars/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
});

export interface AvatarOption {
  id: string;
  label: string;
  keywords: string[];
  src: string;
}

function labelFromId(id: string): string {
  return id
    .split('-')
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

function entryFromPath(path: string, src: string): AvatarOption {
  const filename = path.split('/').pop() ?? '';
  const id = filename.replace(/\.png$/, '');
  const keywords = id.split('-').filter(Boolean);
  return { id, label: labelFromId(id), keywords, src };
}

export const AVATAR_OPTIONS: AvatarOption[] = Object.entries(avatarUrls)
  .map(([path, src]) => entryFromPath(path, src))
  .sort((a, b) => a.label.localeCompare(b.label));

const byId = new Map(AVATAR_OPTIONS.map((a) => [a.id, a]));

export function getAvatar(id: string | null | undefined): AvatarOption | null {
  if (!id) return null;
  return byId.get(id) ?? null;
}
