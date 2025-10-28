import React, { lazy, memo, useMemo, Suspense } from 'react';
import { InView } from 'react-intersection-observer';

import Fields from './fields';
import ResponsiveStyles, { ERROR_COLOR } from './styles';

const TextElement = lazy(
  () => import(/* webpackChunkName: "TextElement" */ './basic/TextElement')
);
const ButtonElement = lazy(
  () => import(/* webpackChunkName: "ButtonElement" */ './basic/ButtonElement')
);
const ImageElement = lazy(
  () => import(/* webpackChunkName: "ImageElement" */ './basic/ImageElement')
);
const ProgressBarElement = lazy(
  () =>
    import(
      /* webpackChunkName: "ProgressBarElement" */ './basic/ProgressBarElement'
    )
);
const VideoElement = lazy(
  () => import(/* webpackChunkName: "VideoElement" */ './basic/VideoElement')
);

const Basic = {
  ImageElement,
  VideoElement,
  TextElement,
  ButtonElement,
  ProgressBarElement
};
const Elements = { ...Basic, ...Fields };

Object.entries(Elements).map(([key, Element]) => {
  // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
  Elements[key] = memo(
    ({
      element,
      children,
      componentOnly = true,
      inlineError = '',
      onView,
      formSettings,
      ...props
    }: any) => {
      const responsiveStyles = useMemo(() => {
        return new ResponsiveStyles(
          element,
          ['container'],
          !componentOnly,
          formSettings?.mobileBreakpoint
        );
      }, [element, componentOnly, formSettings]);

      const featheryElement = (
        <Suspense fallback={<div />}>
          <Element
            element={element}
            responsiveStyles={responsiveStyles}
            {...props}
          />
        </Suspense>
      );

      const e = onView ? (
        <InView onChange={onView}>{featheryElement}</InView>
      ) : (
        featheryElement
      );

      if (componentOnly) {
        return (
          <>
            {children}
            {e}
          </>
        );
      } else {
        return (
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
        );
      }
    }
  );
});

export default Elements;
