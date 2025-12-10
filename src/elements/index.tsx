import React, { memo, useMemo, Suspense, lazy } from 'react';
import { InView } from 'react-intersection-observer';

import Fields from './fields';
import ResponsiveStyles, { ERROR_COLOR } from './styles';
import ImageElement from './basic/ImageElement';
import VideoElement from './basic/VideoElement';
import TextElement from './basic/TextElement';
import ButtonElement from './basic/ButtonElement';
import ProgressBarElement from './basic/ProgressBarElement';

const TableElement = lazy(
  () => import(/* webpackChunkName: "TableElement" */ './basic/TableElement')
);

import ElementSkeleton from './components/skeletons/ElementSkeleton';

const Basic = {
  ImageElement,
  VideoElement,
  TextElement,
  ButtonElement,
  ProgressBarElement,
  TableElement
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
            <ElementSkeleton
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
