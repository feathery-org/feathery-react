import React, { useMemo } from 'react';
import TextNodes from '../components/TextNodes';
import { isNum } from '../../utils/primitives';

// TODO(peter): deprecate once customers have upgraded and backend migrated
function legacyAlignment(alignment) {
  switch (alignment) {
    case 'flex-start':
      return 'left';
    case 'flex-end':
      return 'right';
    default:
      return alignment;
  }
}

function applyTextStyles(element, applyStyles) {
  applyStyles.addTargets('text');
  applyStyles.apply('text', 'layout', (a) => ({
    textAlign: legacyAlignment(a)
  }));
  applyStyles.apply('text', 'line_height', (a) => ({
    lineHeight: isNum(a) ? `${a}px` : 'normal'
  }));
  applyStyles.apply('text', 'letter_spacing', (a) => ({
    letterSpacing: isNum(a) ? `${a}px` : 'normal'
  }));
  applyStyles.apply('text', 'text_transform', (a) => ({
    textTransform: a || 'none'
  }));
  return applyStyles;
}

function TextElement({
  element,
  applyStyles,
  values = null,
  editable = false,
  focused = false,
  textCallbacks = {},
  handleRedirect = () => {},
  conditions = [],
  elementProps = {},
  children
}) {
  const styles = useMemo(
    () => applyTextStyles(element, applyStyles),
    [applyStyles]
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
      <TextNodes
        element={element}
        values={values}
        applyStyles={applyStyles}
        handleRedirect={handleRedirect}
        conditions={conditions}
        editable={editable}
        focused={focused}
        textCallbacks={textCallbacks}
      />
      {children}
    </div>
  );
}

export default TextElement;
