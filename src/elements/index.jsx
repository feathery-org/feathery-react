import React, { memo, useMemo } from 'react';
import VisibilitySensor from 'react-visibility-sensor';

import Fields from './fields';
import TextElement from './basic/TextElement';
import ButtonElement from './basic/ButtonElement';
import ImageElement from './basic/ImageElement';
import ProgressBarElement from './basic/ProgressBarElement';
import VideoElement from './basic/VideoElement';

import ApplyStyles, { mobileBreakpointKey } from './styles';

const Basic = {
  ImageElement,
  VideoElement,
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
  Elements[key] = memo(
    ({ element, componentOnly = true, inlineError = '', onView, ...props }) => {
      const applyStyles = useMemo(() => {
        const as = new ApplyStyles(
          element,
          ['container', 'containerWrapper'],
          !componentOnly
        );
        as.apply('container', 'vertical_layout', (a) => ({
          justifyContent: a
        }));
        as.apply('container', 'layout', (a) => ({
          alignItems: legacyAlignment(a)
        }));
        as.applyPadding('containerWrapper');
        if (key in Basic) as.applyVisibility('container');
        return as;
      }, [element, componentOnly]);
      const featheryElement = (
        <Element element={element} applyStyles={applyStyles} {...props} />
      );
      const e = onView ? (
        <VisibilitySensor onChange={onView}>{featheryElement}</VisibilitySensor>
      ) : (
        featheryElement
      );
      if (componentOnly) return e;
      else {
        const containerStyles = applyStyles.getTarget('container');
        const containerWrapperStyles =
          applyStyles.getTarget('containerWrapper');

        const containerCSS = {
          ...containerStyles,
          [mobileBreakpointKey]: {
            ...containerStyles[mobileBreakpointKey]
          }
        };

        const containerWrapperCSS = {
          ...containerWrapperStyles,
          [mobileBreakpointKey]: {
            ...containerWrapperStyles[mobileBreakpointKey]
          }
        };

        return (
          <div
            css={{
              display: 'flex',
              flexGrow: 1,
              ...containerWrapperCSS
            }}
          >
            <div
              css={{
                display: 'flex',
                flexDirection: 'column',
                width: '100%',
                height: '100%',
                ...containerCSS
              }}
            >
              <>
                {e}
                {inlineError && (
                  <span
                    css={{
                      alignSelf: 'flex-start',
                      color: '#F42525',
                      ...applyStyles.getTarget('error')
                    }}
                  >
                    {inlineError}
                  </span>
                )}
              </>
            </div>
          </div>
        );
      }
    }
  );
});

export default Elements;
