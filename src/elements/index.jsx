import React, { memo, useMemo } from 'react';

import Fields from './fields';
import TextElement from './basic/TextElement';
import ButtonElement from './basic/ButtonElement';
import ImageElement from './basic/ImageElement';
import ProgressBarElement from './basic/ProgressBarElement';

import ApplyStyles, { mobileBreakpointKey } from './styles';

const Basic = {
  ImageElement,
  TextElement,
  ButtonElement,
  ProgressBarElement
};
const Elements = { ...Basic, ...Fields };

// TODO(peter): deprecate once customers have upgraded and backend migrated
function legacyAlignment(alignment) {
  switch (alignment) {
    case 'left':
      return 'flex-start';
    case 'right':
      return 'flex-end';
    default:
      return alignment;
  }
}

Object.entries(Elements).map(([key, Element]) => {
  Elements[key] = memo(({ element, componentOnly = true, ...props }) => {
    const applyStyles = useMemo(() => {
      const as = new ApplyStyles(element, ['container'], !componentOnly);
      as.apply('container', 'vertical_layout', (a) => ({
        justifyContent: a
      }));
      as.apply('container', 'layout', (a) => ({
        alignItems: legacyAlignment(a)
      }));
      if (key === 'TextElement' && element.styles.border_color) {
        as.apply('container', 'border_color', (a) => ({
          border: `1px solid #${a}`
        }));
      }
      if (key in Basic) as.applyVisibility('container');
      return as;
    }, [element, componentOnly]);
    const e = (
      <Element element={element} applyStyles={applyStyles} {...props} />
    );
    if (componentOnly) return e;
    else {
      const layout = applyStyles.getLayout();
      const containerStyles = applyStyles.getTarget('container');
      return (
        <div
          css={{
            display: 'flex',
            flexDirection: 'column',
            ...layout,
            ...containerStyles,
            [mobileBreakpointKey]: {
              ...layout[mobileBreakpointKey],
              ...containerStyles[mobileBreakpointKey]
            }
          }}
        >
          {e}
        </div>
      );
    }
  });
});

export default Elements;
