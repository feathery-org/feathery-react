import React, { useMemo } from 'react';

import { hoverStylesGuard } from '../../utils/browser';

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
  elementProps = {}
}: any) {
  const styles = useMemo(
    () => applyTabsStyles(element, responsiveStyles),
    [responsiveStyles]
  );

  const entries: TabEntry[] = element.properties.tabs_entries ?? [];
  const direction =
    element.properties.direction === 'vertical' ? 'column' : 'row';

  const containerStyles = styles.getTarget('tabsContainer');
  const baseTabStyles = styles.getTarget('tab');
  const activeStyles = styles.getTarget('tabActive');
  const hoverStyles = hoverStylesGuard(styles.getTarget('tabHover'));

  return (
    <div
      id={element.id}
      style={{
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
      {entries.map((entry) => {
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
              onTabClick?.(entry);
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
