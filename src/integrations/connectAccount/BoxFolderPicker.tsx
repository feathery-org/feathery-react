import React, { useCallback, useEffect, useState } from 'react';
import type { ProviderConfigProps } from './providers';

interface BoxFolder {
  id: string;
  name: string;
}

interface BoxCurrentFolder extends BoxFolder {
  can_upload: boolean;
}

interface BrowsePage {
  current_folder: BoxCurrentFolder;
  breadcrumbs: BoxFolder[];
  folders: BoxFolder[];
  next_marker: string;
}

const ROOT_FOLDER_ID = '0';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong';
}

function BoxFolderPicker({
  client,
  provider,
  onSaved,
  onError
}: ProviderConfigProps) {
  const [currentFolder, setCurrentFolder] = useState<BoxCurrentFolder | null>(
    null
  );
  const [breadcrumbs, setBreadcrumbs] = useState<BoxFolder[]>([]);
  const [folders, setFolders] = useState<BoxFolder[]>([]);
  const [nextMarker, setNextMarker] = useState('');
  const [loading, setLoading] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [folderName, setFolderName] = useState('');

  const loadFolder = useCallback(
    async (
      folderId: string,
      opts: { marker?: string; create?: string } = {},
      append = false
    ): Promise<boolean> => {
      setLoading(true);
      try {
        const page: BrowsePage = await client.browseAccountResources(
          provider,
          folderId,
          opts
        );
        setCurrentFolder(page.current_folder);
        setBreadcrumbs(page.breadcrumbs);
        setFolders((prev) =>
          append ? [...prev, ...page.folders] : page.folders
        );
        setNextMarker(page.next_marker);
        return true;
      } catch (error: unknown) {
        onError(getErrorMessage(error));
        return false;
      } finally {
        setLoading(false);
      }
    },
    [client, provider, onError]
  );

  // Only ever runs on mount; loadFolder's identity changes with client/provider,
  // which don't change across this component's lifetime.
  useEffect(() => {
    loadFolder(ROOT_FOLDER_ID);
  }, [loadFolder]);

  const handleCreateFolder = async () => {
    const name = folderName.trim();
    if (!name || !currentFolder) return;
    const success = await loadFolder(currentFolder.id, { create: name });
    if (success) {
      setShowNewFolder(false);
      setFolderName('');
    }
  };

  const handleLoadMore = () => {
    if (!currentFolder) return;
    loadFolder(currentFolder.id, { marker: nextMarker }, true);
  };

  const handleSelect = async () => {
    if (!currentFolder) return;
    setSelecting(true);
    try {
      const response = await client.saveAccountConfig(provider, {
        folder_id: currentFolder.id
      });
      // onSaved is Form's async onSaved (which awaits onFlowSuccess) - if a
      // later action in the chain throws, that rejection has nowhere to go
      // unless caught here, and would otherwise leave the loader spinning.
      Promise.resolve(onSaved(response.values)).catch((error: unknown) =>
        onError(getErrorMessage(error))
      );
    } catch (error: unknown) {
      onError(getErrorMessage(error));
    } finally {
      setSelecting(false);
    }
  };

  const canUpload = currentFolder?.can_upload ?? false;
  const busy = loading || selecting;

  return (
    <div>
      <nav
        aria-label='Folder path'
        css={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '4px',
          paddingBottom: '10px'
        }}
      >
        {breadcrumbs.map((crumb, index) => (
          <span
            key={crumb.id}
            css={{ display: 'flex', alignItems: 'center', gap: '4px' }}
          >
            {index > 0 && <span css={{ color: '#a1a1aa' }}>/</span>}
            <button
              type='button'
              onClick={() => loadFolder(crumb.id)}
              disabled={busy}
              css={{
                background: 'none',
                border: 'none',
                padding: 0,
                color: '#0061d5',
                cursor: 'pointer',
                '&:hover': { textDecoration: 'underline' }
              }}
            >
              {crumb.name}
            </button>
          </span>
        ))}
      </nav>

      <div
        css={{
          border: '1px solid #d4d4d8',
          borderRadius: '8px',
          minHeight: '160px',
          maxHeight: '320px',
          overflowY: 'auto'
        }}
      >
        {folders.map((folder) => (
          <button
            key={folder.id}
            type='button'
            onClick={() => loadFolder(folder.id)}
            disabled={busy}
            css={{
              display: 'block',
              width: '100%',
              padding: '10px 14px',
              border: 'none',
              borderBottom: '1px solid #f4f4f5',
              background: 'none',
              textAlign: 'left',
              cursor: 'pointer',
              '&:hover': { background: '#f4f8ff' }
            }}
          >
            {folder.name}
          </button>
        ))}
        {!folders.length && loading && (
          <div css={{ padding: '14px', color: '#71717a' }}>
            Loading folders...
          </div>
        )}
        {!folders.length && !loading && (
          <div css={{ padding: '14px', color: '#71717a' }}>
            This folder does not contain any folders.
          </div>
        )}
        {nextMarker && (
          <button
            type='button'
            onClick={handleLoadMore}
            disabled={busy}
            css={{
              display: 'block',
              width: '100%',
              padding: '10px 14px',
              border: 'none',
              borderTop: '1px solid #e4e4e7',
              background: 'none',
              color: '#0061d5',
              cursor: 'pointer'
            }}
          >
            Load more
          </button>
        )}
      </div>

      <div css={{ paddingTop: '10px' }}>
        {!showNewFolder ? (
          <button
            type='button'
            onClick={() => setShowNewFolder(true)}
            disabled={busy || !canUpload}
            css={{
              background: 'none',
              border: '1px solid #d4d4d8',
              borderRadius: '6px',
              padding: '6px 10px',
              cursor: 'pointer'
            }}
          >
            New folder
          </button>
        ) : (
          <div css={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              aria-label='Folder name'
              placeholder='Folder name'
              value={folderName}
              onChange={(event) => setFolderName(event.target.value)}
              disabled={busy}
              css={{
                flex: 1,
                padding: '8px 10px',
                border: '1px solid #a1a1aa',
                borderRadius: '6px'
              }}
            />
            <button
              type='button'
              onClick={handleCreateFolder}
              disabled={busy || !folderName.trim()}
              css={{
                border: '1px solid #0061d5',
                background: '#0061d5',
                color: '#fff',
                borderRadius: '6px',
                padding: '8px 14px',
                cursor: 'pointer'
              }}
            >
              Create
            </button>
            <button
              type='button'
              onClick={() => {
                setShowNewFolder(false);
                setFolderName('');
              }}
              disabled={busy}
              css={{
                background: 'none',
                border: 'none',
                color: '#71717a',
                cursor: 'pointer'
              }}
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      <div
        css={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingTop: '16px'
        }}
      >
        <span css={{ color: '#52525b' }}>
          {currentFolder ? currentFolder.name : 'No folder selected'}
        </span>
        <button
          type='button'
          onClick={handleSelect}
          disabled={busy || !currentFolder || !canUpload}
          css={{
            border: '1px solid #0061d5',
            borderRadius: '6px',
            padding: '9px 16px',
            background: '#0061d5',
            color: '#fff',
            cursor: 'pointer',
            '&:disabled': {
              border: '1px solid #d4d4d8',
              background: '#e4e4e7',
              color: '#71717a',
              cursor: 'not-allowed'
            }
          }}
        >
          Select this folder
        </button>
      </div>
    </div>
  );
}

export default BoxFolderPicker;
