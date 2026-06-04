import React, { useMemo } from 'react';

import { adjustColor } from '../../utils/styles';
import { hoverStylesGuard } from '../../utils/browser';

type TabEntry = {
  id: string;
  label: string;
  step_key: string;
};

function applyTabsStyles(element: any, responsiveStyles: any) {
  responsiveStyles.addTargets(
    'tabs',
    'tab',
    'tabActive',
    'tabHover',
    'tabDisabled'
  );

  // Base 'tab' target — applied to every tab button.
  responsiveStyles.applyBackgroundColorGradient('tab');
  responsiveStyles.applyCorners('tab');
  responsiveStyles.applyBoxShadow('tab');
  responsiveStyles.applyTextAlign('tab');
  responsiveStyles.applyBorders({ target: 'tab' });
  // State-specific font colors flow through the .active / :hover /
  // [aria-disabled] selectors set up in JSX, not via :hover/:focus pseudos.
  responsiveStyles.applyFontStyles('tab', false, true);

  // Hover.
  if (element.styles?.hover_background_color) {
    responsiveStyles.applyColor(
      'tabHover',
      'hover_background_color',
      'background'
    );
  } else {
    responsiveStyles.apply('tabHover', 'background_color', (a: any) => {
      if (!a) return {};
      return { background: adjustColor(a, -15) };
    });
  }
  responsiveStyles.applyColor('tabHover', 'hover_font_color', 'color');
  responsiveStyles.applyBorders({ target: 'tabHover', prefix: 'hover_' });

  // Active (matched by .active class in JSX).
  responsiveStyles.applyColor(
    'tabActive',
    'selected_background_color',
    'background'
  );
  responsiveStyles.applyColor('tabActive', 'selected_font_color', 'color');
  responsiveStyles.applyBorders({ target: 'tabActive', prefix: 'selected_' });

  // Disabled (matched by [aria-disabled="true"] in JSX).
  responsiveStyles.applyColor(
    'tabDisabled',
    'disabled_background_color',
    'background'
  );
  responsiveStyles.applyColor('tabDisabled', 'disabled_font_color', 'color');
  responsiveStyles.applyBorders({ target: 'tabDisabled', prefix: 'disabled_' });

  return responsiveStyles;
}

function TabsElement({
  element,
  responsiveStyles,
  editMode,
  changeStep,
  stepKey,
  elementProps = {},
  children
}: any) {
  const styles = useMemo(
    () => applyTabsStyles(element, responsiveStyles),
    [responsiveStyles]
  );

  const props = element.properties ?? {};
  const entries: TabEntry[] = Array.isArray(props.tabs_entries)
    ? props.tabs_entries
    : [];
  const direction = props.direction === 'vertical' ? 'column' : 'row';

  const baseTabStyles = styles.getTarget('tab');
  const activeStyles = styles.getTarget('tabActive');
  const hoverStyles = hoverStylesGuard(styles.getTarget('tabHover'));
  const disabledStyles = styles.getTarget('tabDisabled');

  return (
    <div
      id={element.id}
      style={{
        display: 'flex',
        flexDirection: direction as any,
        width: '100%',
        height: '100%',
        boxSizing: 'border-box'
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
        const disabled = !entry.step_key;
        return (
          <button
            key={entry.id}
            type='button'
            className={isActive ? 'active' : undefined}
            css={{
              flex: 1,
              border: 'none',
              cursor: editMode || disabled ? 'default' : 'pointer',
              transition: '0.2s ease all',
              ...baseTabStyles,
              '&[aria-disabled="true"]': disabledStyles,
              '&[aria-disabled="false"]:hover': hoverStyles,
              '&[aria-disabled="false"].active': activeStyles
            }}
            aria-disabled={disabled}
            onClick={() => {
              if (editMode || disabled) return;
              changeStep(entry.step_key);
            }}
          >
            {entry.label}
          </button>
        );
      })}
      {children}
    </div>
  );
}

export default TabsElement;
