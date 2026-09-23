import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ProviderConfigProps } from './providers';
import { featheryDoc, featheryWindow } from '../../utils/browser';

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
  const message = error instanceof Error ? error.message : '';
  if (/unable to reach the connected account/i.test(message)) {
    return 'We couldn’t access your Box account. Try reconnecting it and then try again.';
  }
  return message || 'We couldn’t load your Box folders. Please try again.';
}

function BoxFolderPicker({
  client,
  provider,
  onSaved,
  onError,
  onClearError,
  onFooterActionChange
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
  const folderCache = useRef(new Map<string, BrowsePage>());
  const folderRequests = useRef(new Map<string, Promise<BrowsePage>>());
  const activeFolderId = useRef('');
  const refreshingOnFocus = useRef(false);

  const requestFolder = useCallback(
    (
      folderId: string,
      opts: { marker?: string; create?: string } = {},
      force = false
    ) => {
      const cacheable = !opts.marker && !opts.create;
      if (!force && cacheable) {
        const cached = folderCache.current.get(folderId);
        if (cached) return Promise.resolve(cached);
      }
      const existingRequest = folderRequests.current.get(folderId);
      if (existingRequest) return existingRequest;
      const request = client.browseAccountResources(
        provider,
        folderId,
        opts
      ) as Promise<BrowsePage>;
      folderRequests.current.set(folderId, request);
      return request
        .then((page) => {
          if (cacheable || !opts.marker)
            folderCache.current.set(folderId, page);
          return page;
        })
        .finally(() => {
          folderRequests.current.delete(folderId);
        });
    },
    [client, provider]
  );

  const applyPage = useCallback((page: BrowsePage, append = false) => {
    setCurrentFolder(page.current_folder);
    setBreadcrumbs(page.breadcrumbs);
    setFolders((prev) => (append ? [...prev, ...page.folders] : page.folders));
    setNextMarker(page.next_marker);
  }, []);

  const prefetchFolder = useCallback(
    (folderId: string) => {
      requestFolder(folderId).catch(() => undefined);
    },
    [requestFolder]
  );

  const loadFolder = useCallback(
    async (
      folderId: string,
      opts: { marker?: string; create?: string } = {},
      append = false
    ): Promise<boolean> => {
      onClearError?.();
      activeFolderId.current = folderId;
      if (!append) {
        setFolders([]);
        setNextMarker('');
      }
      setLoading(true);
      try {
        const isStandardNavigation = !append && !opts.marker && !opts.create;
        const cachedPage = isStandardNavigation
          ? folderCache.current.get(folderId)
          : undefined;
        if (cachedPage) {
          applyPage(cachedPage);
          setLoading(false);
          requestFolder(folderId, {}, true)
            .then((page) => {
              if (activeFolderId.current === folderId) applyPage(page);
            })
            .catch(() => undefined);
          return true;
        }
        const page = await requestFolder(folderId, opts, !isStandardNavigation);
        applyPage(page, append);
        return true;
      } catch (error: unknown) {
        onError(getErrorMessage(error));
        return false;
      } finally {
        setLoading(false);
      }
    },
    [applyPage, onError, requestFolder]
  );

  // Only ever runs on mount; loadFolder's identity changes with client/provider,
  // which don't change across this component's lifetime.
  useEffect(() => {
    loadFolder(ROOT_FOLDER_ID);
  }, [loadFolder]);

  useEffect(() => {
    const refreshActiveFolder = () => {
      const folderId = activeFolderId.current;
      if (
        !folderId ||
        refreshingOnFocus.current ||
        folderRequests.current.has(folderId)
      )
        return;
      refreshingOnFocus.current = true;
      loadFolder(folderId)
        .catch(() => undefined)
        .finally(() => {
          refreshingOnFocus.current = false;
        });
    };
    const handleVisibilityChange = () => {
      if (featheryDoc().visibilityState === 'visible') refreshActiveFolder();
    };
    featheryWindow().addEventListener('focus', refreshActiveFolder);
    featheryDoc().addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      featheryWindow().removeEventListener('focus', refreshActiveFolder);
      featheryDoc().removeEventListener(
        'visibilitychange',
        handleVisibilityChange
      );
    };
  }, [loadFolder]);

  const handleCreateFolder = async () => {
    onClearError?.();
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

  const handleSelect = useCallback(async () => {
    onClearError?.();
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
  }, [client, currentFolder, onClearError, onError, onSaved, provider]);

  const canUpload = currentFolder?.can_upload ?? false;
  const busy = loading || selecting;

  useEffect(() => {
    onFooterActionChange?.({
      label: `Select “${currentFolder?.name || 'this folder'}”`,
      disabled: busy || !currentFolder || !canUpload,
      onClick: handleSelect
    });
    return () => onFooterActionChange?.(null);
  }, [busy, canUpload, currentFolder, handleSelect, onFooterActionChange]);

  return (
    <div
      css={{
        overflow: 'hidden',
        border: '1px solid #d4d4d8',
        borderRadius: '10px',
        background: '#fff'
      }}
    >
      <nav
        aria-label='Folder path'
        css={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '4px',
          minHeight: '36px',
          alignItems: 'center',
          padding: '7px 14px',
          borderBottom: '1px solid #e4e4e7',
          background: '#fafafa'
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
              onMouseEnter={() => prefetchFolder(crumb.id)}
              onFocus={() => prefetchFolder(crumb.id)}
              disabled={busy}
              css={{
                background: 'none',
                border: 'none',
                padding: 0,
                color: '#0061d5',
                fontSize: '14px',
                lineHeight: 1.4,
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
        aria-busy={loading}
        css={{ minHeight: '160px', maxHeight: '280px', overflowY: 'auto' }}
      >
        {folders.map((folder) => (
          <button
            key={folder.id}
            type='button'
            onClick={() => loadFolder(folder.id)}
            onMouseEnter={() => prefetchFolder(folder.id)}
            onFocus={() => prefetchFolder(folder.id)}
            disabled={busy}
            css={{
              display: 'block',
              width: '100%',
              padding: '10px 14px',
              border: 'none',
              borderBottom: '1px solid #f4f4f5',
              background: 'none',
              textAlign: 'left',
              fontSize: '14px',
              lineHeight: 1.4,
              cursor: 'pointer',
              '&:hover': { background: '#f4f8ff' }
            }}
          >
            {folder.name}
          </button>
        ))}
        {!folders.length && loading && (
          <div
            css={{
              padding: '14px',
              color: '#71717a',
              fontSize: '14px',
              lineHeight: 1.4
            }}
          >
            Loading folders...
          </div>
        )}
        {!folders.length && !loading && (
          <div
            css={{
              padding: '14px',
              color: '#71717a',
              fontSize: '14px',
              lineHeight: 1.4
            }}
          >
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

      <div css={{ padding: '10px 14px', borderTop: '1px solid #e4e4e7' }}>
        {!showNewFolder ? (
          <button
            type='button'
            onClick={() => setShowNewFolder(true)}
            disabled={busy || !canUpload}
            css={{
              background: 'none',
              border: '1px solid #d4d4d8',
              borderRadius: '6px',
              height: '32px',
              padding: '6px 10px',
              boxSizing: 'border-box',
              fontSize: '14px',
              lineHeight: 1.4,
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
                height: '32px',
                boxSizing: 'border-box',
                padding: '6px 10px',
                border: '1px solid #a1a1aa',
                borderRadius: '6px',
                fontSize: '14px',
                lineHeight: 1.4
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
                height: '32px',
                padding: '6px 14px',
                boxSizing: 'border-box',
                fontSize: '14px',
                lineHeight: 1.4,
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
                height: '32px',
                padding: '0 4px',
                fontSize: '14px',
                cursor: 'pointer'
              }}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default BoxFolderPicker;
