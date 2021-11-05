import React, { useMemo } from 'react';
import TextNodes from '../components/TextNodes';

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
  applyStyles.applyMargin('text');
  if (element.styles.line_height) {
    applyStyles.apply('text', 'line_height', (a) => ({
      lineHeight: `${a}px`
    }));
  }
  return applyStyles;
}

function TextElement({
  element,
  applyStyles,
  values = null,
  handleRedirect = () => {},
  conditions = []
}) {
  const styles = useMemo(() => applyTextStyles(element, applyStyles), [
    applyStyles
  ]);
  return (
    <div css={styles.getTarget('text')}>
      <TextNodes
        element={element}
        values={values}
        applyStyles={applyStyles}
        handleRedirect={handleRedirect}
        conditions={conditions}
      />
    </div>
  );
}

export default TextElement;
