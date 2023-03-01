import React, { useMemo } from 'react';
import TextNodes from '../components/TextNodes';
import { isNum } from '../../utils/primitives';
import useBorder from '../components/useBorder';

// TODO(peter): deprecate once customers have upgraded and backend migrated
function legacyAlignment(alignment: any) {
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
  responsiveStyles.apply('text', 'layout', (a: any) => ({
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
  children
}: any) {
  const styles = useMemo(
    () => applyTextStyles(element, responsiveStyles),
    [responsiveStyles]
  );
  const { borderStyles, customBorder } = useBorder({ element });
  return (
    <div
      css={{
        position: 'relative',
        maxWidth: '100%',
        ...styles.getTarget('text'),
        '&:hover': editMode
          ? {}
          : {
              ...styles.getTarget('textHover'),
              ...borderStyles.hover
            }
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
      />
    </div>
  );
}

export default TextElement;
