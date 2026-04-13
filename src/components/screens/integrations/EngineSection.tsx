import { useState } from 'react';
import { Cpu, CheckCircle2, XCircle, Loader2, ExternalLink, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { useProviders } from '../../../context/ProviderContext';

export default function EngineSection() {
  const { t } = useTranslation();
  const { claudeCodeInfo, refreshClaudeCodeStatus } = useProviders();
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshClaudeCodeStatus();
    } finally {
      setRefreshing(false);
    }
  };

  const status = claudeCodeInfo.status;
  const isAvailable = status === 'available';
  const isDetecting = status === 'detecting' || status === 'unknown';
  const isUnavailable = status === 'unavailable';
  const isError = status === 'error';

  return (
    <div>
      <h2 className="text-lg font-medium text-text-primary">{t('engineSection.title')}</h2>
      <p className="text-sm text-text-secondary mt-1 leading-relaxed">
        {t('engineSection.description')}
      </p>

      <div className="mt-6 bg-bg-surface border border-border-subtle rounded-lg overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3.5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-violet-500/15 text-violet-400">
            <Cpu size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-text-primary">{t('engineSection.claudeCode')}</div>
            <div className="text-xs text-text-secondary">
              {t('engineSection.claudeCodeDesc')}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isAvailable && (
              <>
                <CheckCircle2 size={14} className="text-emerald-400" />
                <span className="text-xs text-emerald-400">{t('engineSection.detected')}</span>
              </>
            )}
            {isDetecting && (
              <>
                <Loader2 size={14} className="text-amber-400 animate-spin" />
                <span className="text-xs text-amber-400">{t('engineSection.detecting')}</span>
              </>
            )}
            {(isUnavailable || isError) && (
              <>
                <XCircle size={14} className="text-red-400" />
                <span className="text-xs text-red-400">
                  {isUnavailable ? t('engineSection.notFound') : t('engineSection.error')}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="border-t border-border-subtle" />

        {/* Details */}
        <div className="px-4 py-3.5 space-y-2">
          {isAvailable && (
            <>
              {claudeCodeInfo.version && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-text-tertiary">{t('engineSection.version')}</span>
                  <code className="text-text-secondary font-mono">
                    v{claudeCodeInfo.version}
                  </code>
                </div>
              )}
              {claudeCodeInfo.path && (
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-text-tertiary flex-shrink-0">{t('engineSection.path')}</span>
                  <code className="text-text-secondary font-mono truncate">
                    {claudeCodeInfo.path}
                  </code>
                </div>
              )}
            </>
          )}

          {(isUnavailable || isError) && (
            <div className="text-xs text-text-secondary leading-relaxed">
              <p className="mb-2">
                {t('engineSection.notFoundMessage')}{' '}
                {claudeCodeInfo.error && (
                  <span className="text-red-400">{t('engineSection.notFoundError', { error: claudeCodeInfo.error })}</span>
                )}
              </p>
              <p>
                {t('engineSection.installGuide')}{' '}
                <a
                  href="https://docs.claude.com/en/docs/claude-code/setup"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:underline inline-flex items-center gap-1"
                >
                  {t('engineSection.installGuideLink')}
                  <ExternalLink size={10} />
                </a>{' '}
                {t('engineSection.installGuideAfter')}
              </p>
            </div>
          )}

          <div className="pt-2">
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className={clsx(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors',
                refreshing
                  ? 'bg-bg-elevated text-text-tertiary border-border-subtle cursor-not-allowed'
                  : 'bg-bg-elevated text-text-secondary hover:text-text-primary hover:bg-bg-hover border-border-subtle cursor-pointer',
              )}
            >
              <RefreshCw size={11} className={clsx(refreshing && 'animate-spin')} />
              {refreshing ? t('engineSection.detecting') : t('engineSection.redetect')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
