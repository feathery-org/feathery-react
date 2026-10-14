import React from 'react';
import type { DocumentTab } from './documentPacket';

export default function DocumentTabs({
  tabs,
  activeId,
  disabled,
  onSelect,
  id
}: {
  tabs: DocumentTab[];
  activeId?: string;
  disabled: boolean;
  onSelect: (id: string) => void;
  id: string;
}) {
  if (tabs.length < 2) return null;
  return (
    <div
      role='tablist'
      aria-label='Documents'
      aria-busy={disabled}
      css={{
        display: 'flex',
        flexShrink: 0,
        overflowX: 'auto',
        borderBottom: '1px solid #e4e4e7',
        background: '#fafafa'
      }}
    >
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          type='button'
          role='tab'
          id={`${id}-tab-${index}`}
          aria-controls={`${id}-panel`}
          aria-selected={tab.id === activeId}
          aria-disabled={disabled}
          tabIndex={tab.id === activeId ? 0 : -1}
          onClick={() => {
            if (!disabled) onSelect(tab.id);
          }}
          onKeyDown={(event) => {
            const offsets: Record<string, number> = {
              ArrowRight: 1,
              ArrowLeft: -1,
              Home: -index,
              End: tabs.length - 1 - index
            };
            if (!(event.key in offsets)) return;
            event.preventDefault();
            const next =
              (index + offsets[event.key] + tabs.length) % tabs.length;
            const buttons =
              event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                '[role="tab"]'
              );
            buttons?.[next]?.focus();
          }}
          css={{
            flexShrink: 0,
            padding: '10px 16px',
            border: 0,
            borderBottom:
              tab.id === activeId
                ? '2px solid #ef4444'
                : '2px solid transparent',
            background: 'transparent',
            color: tab.id === activeId ? '#18181b' : '#71717a',
            fontSize: 13,
            cursor: disabled ? 'wait' : 'pointer',
            maxWidth: 240,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            '&:focus-visible': {
              outline: '2px solid #ef4444',
              outlineOffset: -2
            }
          }}
          title={tab.label}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
