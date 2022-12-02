import React, { useMemo } from 'react';
import TextNodes from '../components/TextNodes';
import { isNum } from '../../utils/primitives';

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
  responsiveStyles.addTargets('text');
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
  return responsiveStyles;
}

function TextElement({
  element,
  responsiveStyles,
  values = null,
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
  return (
    <div
      css={{
        ...styles.getTarget('text'),
        position: 'relative',
        maxWidth: '100%'
      }}
      {...elementProps}
    >
      {children}
      <TextNodes
        element={element}
        values={values}
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
