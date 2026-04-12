import { useRef } from 'react';
import ChatInput, { type ChatInputHandle } from './ChatInput';
import { useDropZone } from '../../hooks/useDropZone';

interface WelcomeViewProps {
  onSend: (content: string) => void;
}

export default function WelcomeView({ onSend }: WelcomeViewProps) {
  const chatInputRef = useRef<ChatInputHandle>(null);

  const { isDragOver, dropProps } = useDropZone({
    onDrop: (files) => chatInputRef.current?.addAttachments(files),
  });

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-4 relative" {...dropProps}>
      <div className="w-full max-w-2xl">
        <h1 className="text-3xl font-light text-text-primary text-center mb-3">
          What can we help with?
        </h1>
        <p className="text-sm text-text-secondary text-center mb-8">
          Chat with Cerebro or ask an expert — we'll plan, execute, and follow up.
        </p>
        <ChatInput ref={chatInputRef} onSend={onSend} />
      </div>

      {isDragOver && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-accent/5 border-2 border-dashed border-accent/40 rounded-xl pointer-events-none">
          <span className="text-sm font-medium text-accent">Drop files to attach</span>
        </div>
      )}
    </div>
  );
}
