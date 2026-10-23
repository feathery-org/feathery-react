import React, { useMemo } from 'react';

import useMobileViewport from '../../hooks/useMobileViewport';
import { hoverStylesGuard } from '../../utils/browser';
import { isNum } from '../../utils/primitives';
import { INNER_PADDING_KEYS } from '../styles';

type TabEntry = {
  id: string;
  label: string;
  step_key: string;
};

function applyTabsStyles(element: any, responsiveStyles: any) {
  responsiveStyles.addTargets('tabsContainer', 'tab', 'tabActive', 'tabHover');

  responsiveStyles.apply('tabsContainer', 'gap', (gap: number) => ({
    gap: gap ? `${gap}px` : undefined
  }));

  responsiveStyles.applyBackgroundColorGradient('tab');
  responsiveStyles.applyCorners('tab');
  responsiveStyles.applyBoxShadow('tab');
  responsiveStyles.applyTextAlign('tab');
  responsiveStyles.apply(
    'tab',
    INNER_PADDING_KEYS,
    (top: unknown, right: unknown, bottom: unknown, left: unknown) => {
      const padding: React.CSSProperties = {};
      if (isNum(top)) padding.paddingTop = `${top}px`;
      if (isNum(right)) padding.paddingInlineEnd = `${right}px`;
      if (isNum(bottom)) padding.paddingBottom = `${bottom}px`;
      if (isNum(left)) padding.paddingInlineStart = `${left}px`;
      return padding;
    }
  );
  responsiveStyles.applyBorders({ target: 'tab' });
  responsiveStyles.applyFontStyles('tab', false, true);

  responsiveStyles.applyColor(
    'tabHover',
    'hover_background_color',
    'background'
  );
  responsiveStyles.applyColor('tabHover', 'hover_font_color', 'color');
  responsiveStyles.applyBorders({ target: 'tabHover', prefix: 'hover_' });

  responsiveStyles.applyColor(
    'tabActive',
    'selected_background_color',
    'background'
  );
  responsiveStyles.applyColor('tabActive', 'selected_font_color', 'color');
  responsiveStyles.applyBorders({ target: 'tabActive', prefix: 'selected_' });

  return responsiveStyles;
}

function TabsElement({
  element,
  responsiveStyles,
  editMode,
  onTabClick,
  stepKey,
  viewport,
  elementProps = {}
}: any) {
  const styles = useMemo(
    () => applyTabsStyles(element, responsiveStyles),
    [responsiveStyles]
  );

  const isMobileViewport = useMobileViewport(styles.getMobileBreakpoint());
  // The editor previews a viewport inside a desktop browser window.
  const isMobile = viewport ? viewport === 'mobile' : isMobileViewport;
  const presentation =
    (isMobile && element.properties.mobile_presentation) ||
    element.properties.presentation ||
    'tabs';
  const entries: TabEntry[] = element.properties.entries ?? [];
  const direction =
    element.properties.direction === 'vertical' ? 'column' : 'row';

  const containerStyles = styles.getTarget('tabsContainer');
  const baseTabStyles = styles.getTarget('tab');
  const activeStyles = styles.getTarget('tabActive');
  const hoverStyles = hoverStylesGuard(styles.getTarget('tabHover'));

  if (presentation === 'menu') {
    const hasActiveEntry = entries.some((entry) => entry.step_key === stepKey);
    return (
      <div
        id={element.id}
        css={{ width: '100%', minWidth: 0 }}
        {...elementProps}
      >
        <select
          aria-label={element.properties.aria_label || 'Workspace navigation'}
          value={hasActiveEntry ? stepKey : ''}
          disabled={!!editMode || entries.length === 0}
          css={{
            width: '100%',
            minWidth: 0,
            minHeight: 44,
            boxSizing: 'border-box',
            border: '1px solid #c0c4cc',
            borderRadius: 4,
            padding: '8px 12px',
            background: '#fff',
            font: 'inherit',
            color: 'inherit',
            ...baseTabStyles
          }}
          onChange={(event) => {
            if (editMode) return;
            const index = entries.findIndex(
              (entry) => entry.step_key === event.target.value
            );
            if (index < 0 || !entries[index].step_key) return;
            onTabClick?.(entries[index], index);
          }}
        >
          {!hasActiveEntry && (
            <option value='' disabled>
              {element.properties.aria_label || 'Choose a section'}
            </option>
          )}
          {entries.map((entry) => (
            <option key={entry.id} value={entry.step_key}>
              {entry.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div
      id={element.id}
      css={{
        display: 'flex',
        flexDirection: direction as any,
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        ...containerStyles
      }}
      {...elementProps}
    >
      {editMode && entries.length === 0 && (
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1px dashed #c0c4cc',
            color: '#888',
            fontSize: 13,
            padding: '20px 16px',
            minHeight: 50,
            minWidth: 200,
            borderRadius: 4,
            textAlign: 'center',
            boxSizing: 'border-box'
          }}
        >
          Add tabs in the properties panel
        </div>
      )}
      {entries.map((entry, index) => {
        const isActive = entry.step_key === stepKey;
        return (
          <button
            key={entry.id}
            type='button'
            className={isActive ? 'active' : undefined}
            css={{
              flex: 1,
              border: 'none',
              cursor: editMode ? 'default' : 'pointer',
              transition: '0.2s ease all',
              ...baseTabStyles,
              '&:hover': hoverStyles,
              '&.active': activeStyles
            }}
            onClick={() => {
              if (editMode || !entry.step_key) return;
              onTabClick?.(entry, index);
            }}
          >
            {entry.label}
          </button>
        );
      })}
    </div>
  );
}

export default TabsElement;
