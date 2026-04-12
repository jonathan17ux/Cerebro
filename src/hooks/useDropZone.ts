import { useRef, useCallback, useState } from 'react';
import type { AttachmentInfo } from '../types/attachments';
import { generateId } from '../context/chat-helpers';

interface UseDropZoneOptions {
  onDrop: (files: AttachmentInfo[]) => void;
}

export function useDropZone({ onDrop }: UseDropZoneOptions) {
  const [isDragOver, setIsDragOver] = useState(false);
  const counterRef = useRef(0);
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    counterRef.current++;
    if (e.dataTransfer?.types.includes('Files')) {
      setIsDragOver(true);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    counterRef.current--;
    if (counterRef.current <= 0) {
      counterRef.current = 0;
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    counterRef.current = 0;
    setIsDragOver(false);

    const files = Array.from(e.dataTransfer?.files || []);
    const attachments: AttachmentInfo[] = [];
    const seen = new Set<string>();

    for (const file of files) {
      const filePath = window.cerebro.getPathForFile(file);
      if (!filePath || seen.has(filePath)) continue;
      seen.add(filePath);

      const fileName = file.name;
      const ext = fileName.includes('.') ? fileName.split('.').pop()!.toLowerCase() : '';

      attachments.push({
        id: generateId(),
        filePath,
        fileName,
        fileSize: file.size,
        extension: ext,
      });
    }

    if (attachments.length > 0) {
      onDropRef.current(attachments);
    }
  }, []);

  return {
    isDragOver,
    dropProps: {
      onDragEnter: handleDragEnter,
      onDragOver: handleDragOver,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop,
    },
  };
}
