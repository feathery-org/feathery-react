import React, { useEffect, useState } from 'react';
import { ViewerDocument } from '../index';
import PageThumbnails from './PageThumbnails';
import FormsList from './FormsList';
import AttachmentsPanel from './AttachmentsPanel';
import { featheryWindow } from '../../../../utils/browser';

const SIDEBAR_WIDTH = 280;
const COLLAPSE_BREAKPOINT = 1024;

interface ViewerSidebarProps {
  documents: ViewerDocument[];
  pageCounts: Record<string, number>;
  pdfProxies: Record<string, any>;
  onNavigate: (pdfUrl: string, pageIndex: number) => void;
  attachments: { id: string; name: string; position: 'before' | 'after' }[];
  onAddAttachment: (file: File) => void;
  onRemoveAttachment: (index: number) => void;
  uploading: boolean;
  expiresAt?: string;
}

function useIsNarrowViewport() {
  const [isNarrow, setIsNarrow] = useState(
    () =>
      featheryWindow().matchMedia?.(`(max-width: ${COLLAPSE_BREAKPOINT}px)`)
        .matches ?? false
  );

  useEffect(() => {
    const mql = featheryWindow().matchMedia?.(
      `(max-width: ${COLLAPSE_BREAKPOINT}px)`
    );
    if (!mql) return;
    const handler = (e: MediaQueryListEvent) => setIsNarrow(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return isNarrow;
}

export default function ViewerSidebar({
  documents,
  pageCounts,
  pdfProxies,
  onNavigate,
  attachments,
  onAddAttachment,
  onRemoveAttachment,
  uploading,
  expiresAt
}: ViewerSidebarProps) {
  const isNarrow = useIsNarrowViewport();
  const [collapsed, setCollapsed] = useState(true);
  const expanded = !isNarrow || !collapsed;
  const isExpired = expiresAt
    ? new Date(expiresAt).getTime() < Date.now()
    : false;

  return (
    <div css={{ position: 'relative', flexShrink: 0 }}>
      {isNarrow && (
        <button
          type='button'
          aria-label={collapsed ? 'Show sidebar' : 'Hide sidebar'}
          onClick={() => setCollapsed((c) => !c)}
          css={toggleButtonCss}
        >
          {collapsed ? '☰' : '✕'}
        </button>
      )}
      {expanded && (
        <aside
          aria-label='Document sidebar'
          css={{
            width: SIDEBAR_WIDTH,
            height: '100%',
            overflowY: 'auto',
            backgroundColor: 'white',
            borderLeft: '1px solid #e2e4eb',
            display: 'flex',
            flexDirection: 'column',
            ...(isNarrow
              ? {
                  position: 'absolute',
                  right: 0,
                  top: 0,
                  bottom: 0,
                  zIndex: 10,
                  boxShadow: '-4px 0 12px rgba(0,0,0,0.12)'
                }
              : {})
          }}
        >
          <div css={{ flex: 1, overflowY: 'auto' }}>
            <PageThumbnails
              documents={documents}
              pageCounts={pageCounts}
              pdfProxies={pdfProxies}
              onNavigate={onNavigate}
            />
            <FormsList documents={documents} onNavigate={onNavigate} />
            <AttachmentsPanel
              attachments={attachments}
              onAdd={onAddAttachment}
              onRemove={onRemoveAttachment}
              uploading={uploading}
            />
          </div>
          {expiresAt && (
            <div
              css={{
                padding: '12px 20px',
                textAlign: 'right',
                fontSize: 12,
                color: '#b3261e',
                borderTop: '1px solid #e2e4eb'
              }}
            >
              {isExpired ? 'Expired' : 'Expires'}{' '}
              {new Date(expiresAt).toLocaleString()}
            </div>
          )}
        </aside>
      )}
    </div>
  );
}

const toggleButtonCss = {
  position: 'absolute' as const,
  top: 8,
  right: 8,
  zIndex: 11,
  border: '1px solid #e2e4eb',
  background: 'white',
  borderRadius: 6,
  width: 36,
  height: 36,
  cursor: 'pointer',
  fontSize: 16
};
