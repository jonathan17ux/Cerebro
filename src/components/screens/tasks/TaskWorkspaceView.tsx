import { useState, useEffect, useCallback } from 'react';
import { Folder, File, ChevronRight, Loader2, FolderOpen, Terminal } from 'lucide-react';
import clsx from 'clsx';
import type { Task } from './types';

interface FileEntry {
  path: string;
  size: number;
  is_dir: boolean;
}

interface FileContent {
  path: string;
  content: string;
  language: string | null;
  size: number;
}

interface TaskWorkspaceViewProps {
  task: Task;
}

export default function TaskWorkspaceView({ task }: TaskWorkspaceViewProps) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<FileContent | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);

  // Fetch file tree
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    window.cerebro.invoke<{ files: FileEntry[]; truncated: boolean }>({
      method: 'GET',
      path: `/tasks/${task.id}/workspace/tree`,
    }).then((res) => {
      if (cancelled) return;
      if (res.ok && res.data?.files) {
        setFiles(res.data.files);
      }
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [task.id]);

  // Fetch file content
  const openFile = useCallback(async (path: string) => {
    setSelectedFile(path);
    setLoadingFile(true);
    setFileContent(null);
    try {
      const res = await window.cerebro.invoke<FileContent>({
        method: 'GET',
        path: `/tasks/${task.id}/workspace/file?path=${encodeURIComponent(path)}`,
      });
      if (res.ok && res.data) {
        setFileContent(res.data);
      }
    } catch {
      // ignore
    }
    setLoadingFile(false);
  }, [task.id]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center py-16">
        <Loader2 size={18} className="animate-spin text-text-tertiary" />
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center py-16 text-text-tertiary text-sm">
        Workspace is empty
      </div>
    );
  }

  return (
    <div className="flex-1 flex min-h-0">
      {/* File tree */}
      <div className="w-[220px] flex-shrink-0 border-r border-border-subtle overflow-y-auto py-2 px-1">
        {files.map((entry) => (
          <button
            key={entry.path}
            onClick={() => !entry.is_dir && openFile(entry.path)}
            className={clsx(
              'w-full flex items-center gap-1.5 px-2 py-1 text-xs rounded-md transition-colors text-left',
              entry.is_dir
                ? 'text-text-tertiary cursor-default'
                : selectedFile === entry.path
                  ? 'bg-accent/10 text-accent'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-secondary cursor-pointer',
            )}
            style={{ paddingLeft: `${(entry.path.split('/').length - 1) * 12 + 8}px` }}
          >
            {entry.is_dir ? (
              <Folder size={12} className="flex-shrink-0 text-text-tertiary" />
            ) : (
              <File size={12} className="flex-shrink-0" />
            )}
            <span className="truncate">{entry.path.split('/').pop()}</span>
          </button>
        ))}
      </div>

      {/* File preview */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {selectedFile ? (
          <>
            {/* Breadcrumb */}
            <div className="px-3 py-2 border-b border-border-subtle text-xs text-text-tertiary flex items-center gap-1">
              {selectedFile.split('/').map((segment, i, arr) => (
                <span key={i} className="flex items-center gap-1">
                  {i > 0 && <ChevronRight size={10} />}
                  <span className={i === arr.length - 1 ? 'text-text-secondary' : ''}>
                    {segment}
                  </span>
                </span>
              ))}
            </div>
            <div className="flex-1 overflow-auto">
              {loadingFile ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 size={16} className="animate-spin text-text-tertiary" />
                </div>
              ) : fileContent ? (
                <pre className="px-4 py-3 text-xs font-mono text-text-primary whitespace-pre-wrap leading-relaxed">
                  {fileContent.content}
                </pre>
              ) : (
                <div className="flex items-center justify-center py-16 text-text-tertiary text-sm">
                  Failed to load file
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-text-tertiary text-sm">
            Select a file to preview
          </div>
        )}
      </div>
    </div>
  );
}
