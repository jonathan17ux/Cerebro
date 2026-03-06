import { useState } from 'react';
import {
  Brain,
  Save,
  X,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Wrench,
  FileText,
} from 'lucide-react';
import clsx from 'clsx';
import type { ExpertProposal } from '../../types/chat';
import { useChat } from '../../context/ChatContext';
import { useExperts } from '../../context/ExpertContext';
import { apiPatchMessageMetadata, toApiExpertProposal } from '../../context/chat-helpers';

interface ExpertProposalCardProps {
  proposal: ExpertProposal;
  messageId: string;
  conversationId: string;
}

function StatusBadge({ status }: { status: ExpertProposal['status'] }) {
  const styles = {
    proposed: 'bg-cyan-500/15 text-cyan-400',
    previewing: 'bg-yellow-500/15 text-yellow-400',
    saved: 'bg-green-500/15 text-green-400',
    dismissed: 'bg-zinc-500/15 text-zinc-400',
  };
  const labels = {
    proposed: 'Proposed',
    previewing: 'Reviewing',
    saved: 'Saved',
    dismissed: 'Dismissed',
  };

  return (
    <span className={clsx('text-[10px] font-medium px-1.5 py-0.5 rounded-full', styles[status])}>
      {labels[status]}
    </span>
  );
}

export default function ExpertProposalCard({
  proposal,
  messageId,
  conversationId,
}: ExpertProposalCardProps) {
  const { updateMessage } = useChat();
  const { createExpert } = useExperts();
  const [isSaving, setIsSaving] = useState(false);
  const [isPromptExpanded, setIsPromptExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isCollapsed = proposal.status === 'dismissed' || proposal.status === 'saved';

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    try {
      const expert = await createExpert({
        name: proposal.name,
        description: proposal.description,
        domain: proposal.domain,
        systemPrompt: proposal.systemPrompt,
        toolAccess: proposal.toolAccess.length > 0 ? proposal.toolAccess : undefined,
        source: 'user',
      });
      if (expert) {
        // Seed suggested context file if provided
        if (proposal.suggestedContextFile) {
          try {
            await window.cerebro.invoke({
              method: 'PUT',
              path: `/memory/context-files/expert:${expert.id}`,
              body: { content: proposal.suggestedContextFile },
            });
          } catch {
            // Non-critical — expert was created, context file just failed
            console.warn('Failed to seed expert context file');
          }
        }
        const saved = { ...proposal, status: 'saved' as const, savedExpertId: expert.id };
        updateMessage(conversationId, messageId, { expertProposal: saved });
        apiPatchMessageMetadata(conversationId, messageId, {
          expert_proposal: toApiExpertProposal(saved),
        }).catch(console.error);
      } else {
        setError('Failed to save expert. Please try again.');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(`Failed to save: ${msg}`);
      console.error('Failed to save expert:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handlePreview = () => {
    setIsPromptExpanded(!isPromptExpanded);
    if (!isPromptExpanded) {
      const previewing = { ...proposal, status: 'previewing' as const };
      updateMessage(conversationId, messageId, { expertProposal: previewing });
      apiPatchMessageMetadata(conversationId, messageId, {
        expert_proposal: toApiExpertProposal(previewing),
      }).catch(console.error);
    } else {
      const proposed = { ...proposal, status: 'proposed' as const };
      updateMessage(conversationId, messageId, { expertProposal: proposed });
      apiPatchMessageMetadata(conversationId, messageId, {
        expert_proposal: toApiExpertProposal(proposed),
      }).catch(console.error);
    }
  };

  const handleDismiss = () => {
    const dismissed = { ...proposal, status: 'dismissed' as const };
    updateMessage(conversationId, messageId, { expertProposal: dismissed });
    apiPatchMessageMetadata(conversationId, messageId, {
      expert_proposal: toApiExpertProposal(dismissed),
    }).catch(console.error);
  };

  return (
    <div
      className={clsx(
        'animate-card-in rounded-lg border overflow-hidden',
        isCollapsed
          ? 'border-border-subtle bg-bg-surface/30 opacity-60'
          : 'border-purple-500/30 bg-bg-surface/50',
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2.5 px-3 py-2">
        <Brain size={14} className={isCollapsed ? 'text-text-tertiary' : 'text-purple-400'} />
        <span
          className={clsx(
            'flex-1 text-xs font-medium truncate',
            isCollapsed ? 'text-text-tertiary' : 'text-text-secondary',
          )}
        >
          {proposal.name}
        </span>
        <StatusBadge status={proposal.status} />
      </div>

      {/* Description */}
      {proposal.description && !isCollapsed && (
        <div className="border-t border-border-subtle px-3 py-1.5">
          <p className="text-[11px] text-text-tertiary leading-relaxed">{proposal.description}</p>
        </div>
      )}

      {/* Metadata row */}
      {!isCollapsed && (
        <div className="border-t border-border-subtle px-3 py-1.5 flex items-center gap-3 flex-wrap">
          <span className="flex items-center gap-1 text-[10px] text-text-tertiary">
            <Brain size={10} />
            {proposal.domain}
          </span>
          {proposal.toolAccess.length > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-text-tertiary">
              <Wrench size={10} />
              {proposal.toolAccess.length} tool{proposal.toolAccess.length !== 1 && 's'}
            </span>
          )}
          {proposal.suggestedContextFile && (
            <span className="flex items-center gap-1 text-[10px] text-text-tertiary">
              <FileText size={10} />
              Context file included
            </span>
          )}
        </div>
      )}

      {/* System prompt preview (expandable) */}
      {!isCollapsed && (
        <div className="border-t border-border-subtle px-3 py-2">
          <div
            className={clsx(
              'text-[11px] text-text-tertiary font-mono leading-relaxed whitespace-pre-wrap',
              !isPromptExpanded && 'line-clamp-4',
            )}
          >
            {proposal.systemPrompt}
          </div>
        </div>
      )}

      {/* Inline error */}
      {error && (
        <div className="border-t border-red-500/20 px-3 py-1.5 flex items-center gap-1.5">
          <AlertCircle size={11} className="text-red-400 flex-shrink-0" />
          <span className="text-[11px] text-red-400">{error}</span>
        </div>
      )}

      {/* Actions */}
      {(proposal.status === 'proposed' || proposal.status === 'previewing') && (
        <div className="border-t border-border-subtle px-3 py-2 flex items-center gap-2">
          <button
            onClick={handlePreview}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium bg-bg-hover/50 text-text-secondary hover:bg-bg-hover transition-colors cursor-pointer"
          >
            {isPromptExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            {isPromptExpanded ? 'Collapse' : 'Preview'}
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium bg-purple-500/15 text-purple-400 hover:bg-purple-500/25 transition-colors cursor-pointer disabled:opacity-50"
          >
            <Save size={11} />
            Save Expert
          </button>
          <button
            onClick={handleDismiss}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium text-text-tertiary hover:text-text-secondary hover:bg-bg-hover/50 transition-colors cursor-pointer ml-auto"
          >
            <X size={11} />
            Dismiss
          </button>
        </div>
      )}

      {proposal.status === 'saved' && (
        <div className="border-t border-border-subtle px-3 py-2">
          <span className="flex items-center gap-1.5 text-[11px] text-green-400 font-medium">
            <CheckCircle2 size={12} />
            Saved as expert
          </span>
        </div>
      )}
    </div>
  );
}
