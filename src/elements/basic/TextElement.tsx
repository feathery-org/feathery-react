import React, { useMemo } from 'react';
import TextNodes from '../components/TextNodes';
import { isNum } from '../../utils/primitives';
import useBorder from '../components/useBorder';
import { hoverStylesGuard } from '../../utils/browser';

// TODO(peter): deprecate once customers have upgraded and backend migrated
function legacyAlignment(alignment: any) {
  if (!alignment) {
    return undefined;
  }

  switch (alignment) {
    case 'flex-start':
      return 'left';
    case 'flex-end':
      return 'right';
    default:
      return alignment;
  }
}

function applyTextStyles(element: any, responsiveStyles: any) {
  responsiveStyles.addTargets('text', 'textHover');
  responsiveStyles.apply('text', 'horizontal_align', (a: any) => ({
    textAlign: legacyAlignment(a)
  }));
  responsiveStyles.apply('text', 'line_height', (a: any) => ({
    lineHeight: isNum(a) ? `${a}px` : 'normal'
  }));
  responsiveStyles.apply('text', 'letter_spacing', (a: any) => ({
    letterSpacing: isNum(a) ? `${a}px` : 'normal'
  }));
  responsiveStyles.apply('text', 'text_transform', (a: any) => ({
    textTransform: a || 'none'
  }));
  responsiveStyles.applyColor('text', 'background_color', 'backgroundColor');

  responsiveStyles.applyColor(
    'textHover',
    `hover_background_color`,
    'backgroundColor',
    true
  );
  responsiveStyles.applySpanSelectorStyles('textHover', 'hover_');

  return responsiveStyles;
}

function TextElement({
  element,
  responsiveStyles,
  editMode,
  focused = false,
  textCallbacks = {},
  textSpanOnClick = () => {},
  conditions = [],
  elementProps = {},
  children,
  featheryContext
}: any) {
  const styles = useMemo(
    () => applyTextStyles(element, responsiveStyles),
    [responsiveStyles]
  );
  const { borderStyles, customBorder } = useBorder({
    element,
    corners: false,
    breakpoint: responsiveStyles.getMobileBreakpoint()
  });
  return (
    <div
      css={{
        position: 'relative',
        maxWidth: '100%',
        width: '100%',
        ...styles.getTarget('text'),
        '&:hover': hoverStylesGuard(
          editMode
            ? {}
            : {
                ...styles.getTarget('textHover'),
                ...borderStyles.hover
              }
        )
      }}
      {...elementProps}
    >
      {customBorder}
      {children}
      <TextNodes
        element={element}
        responsiveStyles={responsiveStyles}
        textSpanOnClick={textSpanOnClick}
        conditions={conditions}
        editMode={editMode}
        focused={focused}
        textCallbacks={textCallbacks}
        featheryContext={featheryContext}
      />
    </div>
  );
}

export default TextElement;
