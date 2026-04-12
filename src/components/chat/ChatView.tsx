import { useRef } from 'react';
import type { Conversation } from '../../types/chat';
import MessageList from './MessageList';
import ChatInput, { type ChatInputHandle } from './ChatInput';
import SandboxBanner from './SandboxBanner';
import { useDropZone } from '../../hooks/useDropZone';

interface ChatViewProps {
  conversation: Conversation;
  onSend: (content: string) => void;
  isStreaming: boolean;
  isThinking: boolean;
}

export default function ChatView({ conversation, onSend, isStreaming, isThinking }: ChatViewProps) {
  const chatInputRef = useRef<ChatInputHandle>(null);

  const { isDragOver, dropProps } = useDropZone({
    onDrop: (files) => chatInputRef.current?.addAttachments(files),
  });

  return (
    <div className="flex-1 flex flex-col min-h-0 relative" {...dropProps}>
      <SandboxBanner />
      <MessageList messages={conversation.messages} isThinking={isThinking} />
      <div className="px-4 pb-4">
        <div className="mx-auto max-w-3xl">
          <ChatInput ref={chatInputRef} onSend={onSend} isStreaming={isStreaming} />
        </div>
      </div>

      {isDragOver && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-accent/5 border-2 border-dashed border-accent/40 rounded-xl pointer-events-none">
          <span className="text-sm font-medium text-accent">Drop files to attach</span>
        </div>
      )}
    </div>
  );
}
