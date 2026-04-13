import { Users, Zap, Activity, ShieldCheck, Store } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Screen } from '../../types/chat';

const SCREEN_META: Record<string, { icon: typeof Users; titleKey: string; descKey: string }> = {
  experts: {
    icon: Users,
    titleKey: 'nav.experts',
    descKey: 'placeholder.experts',
  },
  routines: {
    icon: Zap,
    titleKey: 'nav.routines',
    descKey: 'placeholder.routines',
  },
  activity: {
    icon: Activity,
    titleKey: 'nav.activity',
    descKey: 'placeholder.activity',
  },
  approvals: {
    icon: ShieldCheck,
    titleKey: 'nav.approvals',
    descKey: 'placeholder.approvals',
  },
  marketplace: {
    icon: Store,
    titleKey: 'nav.skills',
    descKey: 'placeholder.marketplace',
  },
};

interface PlaceholderScreenProps {
  screen: Screen;
}

export default function PlaceholderScreen({ screen }: PlaceholderScreenProps) {
  const { t } = useTranslation();
  const meta = SCREEN_META[screen];
  if (!meta) return null;

  const Icon = meta.icon;

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-4">
      <div className="flex flex-col items-center max-w-md text-center">
        <div className="w-14 h-14 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center mb-5">
          <Icon size={24} className="text-accent" />
        </div>
        <h1 className="text-2xl font-medium text-text-primary mb-2">{t(meta.titleKey)}</h1>
        <p className="text-sm text-text-secondary leading-relaxed mb-6">{t(meta.descKey)}</p>
        <span className="text-xs text-text-tertiary bg-bg-elevated px-3 py-1.5 rounded-full border border-border-subtle">
          {t('common.comingSoon')}
        </span>
      </div>
    </div>
  );
}
