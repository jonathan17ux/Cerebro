import { X, Zap } from 'lucide-react';
import type { Node } from '@xyflow/react';
import SchedulePicker from '../../ui/SchedulePicker';
import type { DayOfWeek } from '../../../utils/cron-helpers';
import { cronToSchedule, scheduleToCron, WEEKDAYS } from '../../../utils/cron-helpers';

const TEAL = '#14b8a6';

interface TriggerConfigPanelProps {
  node: Node;
  onUpdate: (nodeId: string, partial: Record<string, unknown>) => void;
  onClose: () => void;
}

export default function TriggerConfigPanel({ node, onUpdate, onClose }: TriggerConfigPanelProps) {
  const data = node.data as { triggerType: string; config: Record<string, unknown> };
  const triggerType = data.triggerType;
  const config = data.config ?? {};

  const updateConfig = (partial: Record<string, unknown>) => {
    onUpdate(node.id, {
      config: { ...config, ...partial },
    });
  };

  // Schedule state from cron
  const schedule = (() => {
    if (triggerType !== 'trigger_schedule') return null;
    const cron = config.cron_expression as string;
    if (!cron) return { days: WEEKDAYS as DayOfWeek[], time: '09:00' };
    return cronToSchedule(cron);
  })();

  return (
    <div className="absolute top-0 right-0 bottom-0 w-[380px] z-20 bg-bg-surface border-l border-border-subtle shadow-xl flex flex-col animate-slide-in-right overflow-y-auto">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border-subtle">
        <div
          className="w-6 h-6 rounded flex items-center justify-center"
          style={{ backgroundColor: `${TEAL}20` }}
        >
          <Zap size={14} style={{ color: TEAL }} />
        </div>
        <span className="text-sm font-semibold text-text-primary flex-1">
          Trigger Configuration
        </span>
        <button
          onClick={onClose}
          className="p-1 rounded text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      <div className="p-4 space-y-5">
        {/* Trigger type display */}
        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-wider text-text-tertiary mb-1.5">
            Type
          </label>
          <div className="text-sm text-text-primary capitalize">
            {triggerType.replace('trigger_', '')}
          </div>
        </div>

        {/* Schedule config */}
        {triggerType === 'trigger_schedule' && schedule && (
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-text-tertiary mb-2">
              Schedule
            </label>
            <SchedulePicker
              selectedDays={schedule.days}
              time={schedule.time}
              onDaysChange={(days) => {
                const cron = scheduleToCron({ days, time: schedule.time });
                updateConfig({ cron_expression: cron });
              }}
              onTimeChange={(time) => {
                const cron = scheduleToCron({ days: schedule.days, time });
                updateConfig({ cron_expression: cron });
              }}
            />
          </div>
        )}

        {/* Manual — nothing to configure */}
        {triggerType === 'trigger_manual' && (
          <div className="bg-bg-hover/50 rounded-lg p-3">
            <p className="text-xs text-text-tertiary">
              This routine will run when you click the "Run" button.
            </p>
          </div>
        )}

        {/* Webhook config */}
        {triggerType === 'trigger_webhook' && (
          <>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-text-tertiary mb-1.5">
                Path
              </label>
              <input
                type="text"
                value={(config.path as string) ?? ''}
                onChange={(e) => updateConfig({ path: e.target.value })}
                placeholder="/webhook/my-endpoint"
                className="w-full h-8 px-3 text-xs bg-bg-base border border-border-subtle rounded-md text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent/50"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-text-tertiary mb-1.5">
                Secret (optional)
              </label>
              <input
                type="password"
                value={(config.secret as string) ?? ''}
                onChange={(e) => updateConfig({ secret: e.target.value })}
                placeholder="Auth token for verification"
                className="w-full h-8 px-3 text-xs bg-bg-base border border-border-subtle rounded-md text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent/50"
              />
            </div>
          </>
        )}

        {/* App Event config */}
        {triggerType === 'trigger_app_event' && (
          <div className="bg-bg-hover/50 rounded-lg p-3">
            <p className="text-xs text-text-tertiary">
              App Event triggers are coming soon. Configure your app integrations in Connections first.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
