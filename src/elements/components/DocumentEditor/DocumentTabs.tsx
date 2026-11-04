import React, { useLayoutEffect, useRef, useState } from 'react';
import Menu from '../DocxEditor/DocxToolbar/Menu';
import type { DocumentTab } from './documentPacket';
import { visibleDocumentTabs } from './documentTabOverflow';

const tabStyle = {
  padding: '10px 16px',
  border: 0,
  borderBottom: '2px solid transparent',
  background: 'transparent',
  color: '#71717a',
  fontSize: 13,
  fontFamily: 'inherit',
  maxWidth: 240,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  boxSizing: 'border-box',
  '@media (hover: hover)': {
    '&:not(:disabled):not([aria-disabled="true"]):hover': {
      background: '#e4e4e7',
      color: '#18181b'
    }
  },
  '&:focus-visible': { outline: '2px solid #ef4444', outlineOffset: -2 }
} as const;

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
  const rowRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const focusSelection = useRef<string | null>(null);
  const [visible, setVisible] = useState<number[]>(tabs.map((_, i) => i));
  const tabKey = JSON.stringify(tabs.map(({ id, label }) => [id, label]));

  useLayoutEffect(() => {
    const row = rowRef.current;
    const measure = measureRef.current;
    if (!row || !measure) return;
    const recompute = () => {
      if (!row.clientWidth) return;
      const widths = Array.from(
        measure.querySelectorAll<HTMLElement>('[data-measure-tab]')
      ).map((node) => node.getBoundingClientRect().width);
      const triggerWidth =
        measure.lastElementChild?.getBoundingClientRect().width ?? 100;
      const next = visibleDocumentTabs(
        widths,
        row.clientWidth,
        tabs.findIndex((tab) => tab.id === activeId),
        triggerWidth
      );
      setVisible((previous) =>
        previous.join(',') === next.join(',') ? previous : next
      );
    };
    recompute();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(recompute);
    observer.observe(row);
    Array.from(measure.children).forEach((node) => observer.observe(node));
    return () => observer.disconnect();
    // Content, not object identity, determines the measured widths.
  }, [tabKey, activeId]);

  useLayoutEffect(() => {
    if (focusSelection.current !== activeId) return;
    const tab = rowRef.current?.querySelector<HTMLButtonElement>(
      '[aria-selected="true"]'
    );
    if (tab) {
      tab.focus();
      focusSelection.current = null;
    }
  }, [activeId, visible]);

  if (tabs.length < 2) return null;
  const shown = visible.filter((index) => tabs[index]);
  const overflow = tabs.filter((_, index) => !shown.includes(index));
  return (
    <div
      ref={rowRef}
      css={{
        position: 'relative',
        display: 'flex',
        minWidth: 0,
        flexShrink: 0,
        borderBottom: '1px solid #e4e4e7',
        background: '#fafafa'
      }}
    >
      <div
        ref={measureRef}
        aria-hidden
        css={{
          position: 'absolute',
          width: '100%',
          display: 'flex',
          visibility: 'hidden',
          height: 0,
          overflow: 'hidden',
          pointerEvents: 'none'
        }}
      >
        {tabs.map((tab) => (
          <span
            key={tab.id}
            data-measure-tab
            css={{ ...tabStyle, flexShrink: 0 }}
          >
            {tab.label}
          </span>
        ))}
        <span css={{ ...tabStyle, flexShrink: 0 }}>{tabs.length} more…</span>
      </div>
      <div
        role='tablist'
        aria-label='Documents'
        aria-busy={disabled}
        css={{ display: 'flex', minWidth: 0, overflow: 'hidden' }}
      >
        {shown.map((index) => {
          const tab = tabs[index];
          return (
            <button
              key={tab.id}
              type='button'
              role='tab'
              id={`${id}-tab-${index}`}
              aria-controls={`${id}-panel`}
              aria-selected={tab.id === activeId}
              aria-disabled={disabled}
              tabIndex={tab.id === activeId ? 0 : -1}
              title={tab.label}
              onClick={() => {
                if (!disabled) onSelect(tab.id);
              }}
              onKeyDown={(event) => {
                const position = shown.indexOf(index);
                const offsets: Record<string, number> = {
                  ArrowRight: 1,
                  ArrowLeft: -1,
                  Home: -position,
                  End: shown.length - 1 - position
                };
                if (!(event.key in offsets)) return;
                event.preventDefault();
                const next =
                  (position + offsets[event.key] + shown.length) % shown.length;
                event.currentTarget.parentElement
                  ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
                  [next]?.focus();
              }}
              css={{
                ...tabStyle,
                flexShrink: shown.length === 1 ? 1 : 0,
                borderBottomColor:
                  tab.id === activeId ? '#ef4444' : 'transparent',
                color: tab.id === activeId ? '#18181b' : '#71717a',
                cursor: disabled ? 'wait' : 'pointer'
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {overflow.length > 0 && (
        <div css={{ flexShrink: 0 }}>
          <Menu
            align='end'
            trigger={({ open, toggle }) => (
              <button
                ref={triggerRef}
                type='button'
                aria-label='More documents'
                aria-haspopup='menu'
                aria-expanded={open}
                disabled={disabled}
                onClick={toggle}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown' && !open) {
                    event.preventDefault();
                    toggle();
                  }
                }}
                css={{ ...tabStyle, cursor: disabled ? 'wait' : 'pointer' }}
              >
                {overflow.length} more…
              </button>
            )}
          >
            {(close) => (
              <div
                role='menu'
                aria-label='More documents'
                css={{
                  width: 'min(300px, calc(100vw - 32px))',
                  maxHeight: 320,
                  overflowY: 'auto',
                  padding: 4
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    close();
                    triggerRef.current?.focus();
                    return;
                  }
                  const buttons = Array.from(
                    event.currentTarget.querySelectorAll<HTMLButtonElement>(
                      '[role="menuitem"]'
                    )
                  );
                  const position = buttons.indexOf(
                    event.target as HTMLButtonElement
                  );
                  const offsets: Record<string, number> = {
                    ArrowDown: 1,
                    ArrowUp: -1,
                    Home: -position,
                    End: buttons.length - 1 - position
                  };
                  if (!(event.key in offsets)) return;
                  event.preventDefault();
                  buttons[
                    (position + offsets[event.key] + buttons.length) %
                      buttons.length
                  ]?.focus();
                }}
              >
                {overflow.map((tab, index) => (
                  <button
                    key={tab.id}
                    type='button'
                    role='menuitem'
                    autoFocus={index === 0}
                    disabled={disabled}
                    title={tab.label}
                    onClick={() => {
                      if (disabled) return;
                      focusSelection.current = tab.id;
                      close();
                      onSelect(tab.id);
                    }}
                    css={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      padding: '8px 10px',
                      border: 0,
                      borderRadius: 6,
                      background: 'transparent',
                      color: '#18181b',
                      fontSize: 13,
                      cursor: 'pointer',
                      overflowWrap: 'anywhere',
                      '&:hover, &:focus-visible': { background: '#f4f4f5' }
                    }}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            )}
          </Menu>
        </div>
      )}
    </div>
  );
}
