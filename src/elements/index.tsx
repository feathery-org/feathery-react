import React, { lazy, memo, useMemo, Suspense } from 'react';
import { InView } from 'react-intersection-observer';

import Fields from './fields';
import ResponsiveStyles, { ERROR_COLOR } from './styles';
import ImageElement from './basic/ImageElement';
import VideoElement from './basic/VideoElement';
import TextElement from './basic/TextElement';
import ButtonElement from './basic/ButtonElement';
import ProgressBarElement from './basic/ProgressBarElement';
import FieldSkeleton from './components/skeletons/FieldSkeleton';

// Set to a number (in ms) to artificially delay lazy loading for testing fallback UI
const ARTIFICIAL_DELAY = 5000;

export const delayImport = <T,>(importFn: () => Promise<T>): Promise<T> => {
  if (ARTIFICIAL_DELAY > 0) {
    return new Promise((resolve) => {
      setTimeout(() => {
        importFn().then(resolve);
      }, ARTIFICIAL_DELAY);
    });
  }
  return importFn();
};

// const TextElement = lazy(() =>
//   delayImport(
//     () => import(/* webpackChunkName: "TextElement" */ './basic/TextElement')
//   )
// );
// const ButtonElement = lazy(() =>
//   delayImport(
//     () =>
//       import(/* webpackChunkName: "ButtonElement" */ './basic/ButtonElement')
//   )
// );
// const ImageElement = lazy(() =>
//   delayImport(
//     () => import(/* webpackChunkName: "ImageElement" */ './basic/ImageElement')
//   )
// );
// const ProgressBarElement = lazy(() =>
//   delayImport(
//     () =>
//       import(
//         /* webpackChunkName: "ProgressBarElement" */ './basic/ProgressBarElement'
//       )
//   )
// );
// const VideoElement = lazy(() =>
//   delayImport(
//     () => import(/* webpackChunkName: "VideoElement" */ './basic/VideoElement')
//   )
// );

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
        <Suspense
          fallback={
            <FieldSkeleton
              element={element}
              responsiveStyles={responsiveStyles}
            />
          }
        >
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
