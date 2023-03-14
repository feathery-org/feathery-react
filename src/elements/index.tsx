import React, { memo, useMemo } from 'react';
import VisibilitySensor from 'react-visibility-sensor';

import Fields from './fields';
import TextElement from './basic/TextElement';
import ButtonElement from './basic/ButtonElement';
import ImageElement from './basic/ImageElement';
import ProgressBarElement from './basic/ProgressBarElement';
import VideoElement from './basic/VideoElement';

import ResponsiveStyles, { mobileBreakpointKey, ERROR_COLOR } from './styles';

const Basic = {
  ImageElement,
  VideoElement,
  TextElement,
  ButtonElement,
  ProgressBarElement
};
const Elements = { ...Basic, ...Fields };

// TODO(peter): deprecate once customers have upgraded and backend migrated
function legacyAlignment(alignment: any) {
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
  // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
  Elements[key] = memo(
    ({
      element,
      children,
      componentOnly = true,
      inlineError = '',
      onView,
      ...props
    }: any) => {
      const responsiveStyles = useMemo(() => {
        const as = new ResponsiveStyles(
          element,
          ['container', 'containerWrapper'],
          !componentOnly
        );
        as.apply('container', 'vertical_alignment', (a: any) => ({
          justifyContent: a
        }));
        as.apply('container', 'horizontal_alignment', (a: any) => ({
          alignItems: legacyAlignment(a)
        }));
        as.applyPadding('containerWrapper');
        if (key in Basic) as.applyVisibility('container');
        return as;
      }, [element, componentOnly]);
      const featheryElement = (
        <Element
          element={element}
          responsiveStyles={responsiveStyles}
          {...props}
        />
      );
      const e = onView ? (
        <VisibilitySensor onChange={onView}>{featheryElement}</VisibilitySensor>
      ) : (
        featheryElement
      );
      if (componentOnly)
        return (
          <>
            {children}
            {e}
          </>
        );
      else {
        const containerStyles = responsiveStyles.getTarget('container');
        const containerWrapperStyles =
          responsiveStyles.getTarget('containerWrapper');

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
                      color: ERROR_COLOR,
                      ...responsiveStyles.getTarget('error')
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
