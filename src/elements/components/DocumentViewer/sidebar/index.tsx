import React, { useState } from 'react';
import { ViewerDocument } from '../index';
import PageThumbnails from './PageThumbnails';
import DocumentsPanel from './DocumentsPanel';
import { color, fontSize, shadow } from '../tokens';
import { iconButtonCss } from '../buttonStyles';
import { MenuIcon, CloseIcon } from '../icons';

const SIDEBAR_WIDTH = 240;

interface ViewerSidebarProps {
  documents: ViewerDocument[];
  pageCounts: Record<string, number>;
  pdfProxies: Record<string, any>;
  activeKey: string;
  onNavigate: (pdfUrl: string, pageIndex: number) => void;
  isNarrow: boolean;
}

export default function ViewerSidebar({
  documents,
  pageCounts,
  pdfProxies,
  activeKey,
  onNavigate,
  isNarrow
}: ViewerSidebarProps) {
  const [tab, setTab] = useState<'pages' | 'documents'>('pages');
  const [collapsed, setCollapsed] = useState(true);
  const expanded = !isNarrow || !collapsed;

  return (
    <div css={{ position: 'relative', flexShrink: 0 }}>
      {isNarrow && (
        <button
          type='button'
          aria-label={collapsed ? 'Show sidebar' : 'Hide sidebar'}
          onClick={() => setCollapsed((c) => !c)}
          css={{
            ...iconButtonCss,
            position: 'absolute',
            top: 8,
            left: 8,
            zIndex: 11,
            backgroundColor: color.surface,
            border: `1px solid ${color.border}`
          }}
        >
          {collapsed ? <MenuIcon size={18} /> : <CloseIcon size={18} />}
        </button>
      )}
      {expanded && (
        <aside
          aria-label='Document sidebar'
          css={{
            width: SIDEBAR_WIDTH,
            height: '100%',
            backgroundColor: color.surface,
            borderRight: `1px solid ${color.border}`,
            display: 'flex',
            flexDirection: 'column',
            ...(isNarrow
              ? {
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  bottom: 0,
                  zIndex: 10,
                  boxShadow: shadow.drawer
                }
              : {})
          }}
        >
          <div
            role='tablist'
            css={{
              display: 'flex',
              borderBottom: `1px solid ${color.border}`,
              flexShrink: 0,
              ...(isNarrow ? { paddingLeft: 44 } : {})
            }}
          >
            {(['pages', 'documents'] as const).map((t) => (
              <button
                key={t}
                type='button'
                role='tab'
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                css={{
                  flex: 1,
                  padding: '10px 0',
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  fontSize: fontSize.base,
                  fontWeight: tab === t ? 600 : 400,
                  color: tab === t ? color.text : color.textMuted,
                  boxShadow:
                    tab === t ? `inset 0 -2px 0 ${color.accent}` : 'none'
                }}
              >
                {t === 'pages' ? 'Pages' : 'Documents'}
              </button>
            ))}
          </div>
          <div css={{ flex: 1, overflowY: 'auto' }}>
            {tab === 'pages' ? (
              <PageThumbnails
                documents={documents}
                pageCounts={pageCounts}
                pdfProxies={pdfProxies}
                activeKey={activeKey}
                onNavigate={onNavigate}
              />
            ) : (
              <DocumentsPanel documents={documents} onNavigate={onNavigate} />
            )}
          </div>
        </aside>
      )}
    </div>
  );
}
