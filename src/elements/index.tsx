import React, { memo, useId, useMemo, Suspense, lazy } from 'react';
import { InView } from 'react-intersection-observer';

import Fields from './fields';
import ResponsiveStyles, { ERROR_COLOR } from './styles';
import ImageElement from './basic/ImageElement';
import VideoElement from './basic/VideoElement';
import TextElement from './basic/TextElement';
import ButtonElement from './basic/ButtonElement';
import ProgressBarElement from './basic/ProgressBarElement';

import ElementSkeleton from './components/skeletons/ElementSkeleton';

const TableElement = lazy(
  () => import(/* webpackChunkName: "TableElement" */ './basic/TableElement')
);

const TabsElement = lazy(
  () => import(/* webpackChunkName: "TabsElement" */ './basic/TabsElement')
);

const Basic = {
  ImageElement,
  VideoElement,
  TextElement,
  ButtonElement,
  ProgressBarElement,
  TableElement,
  TabsElement
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
      elementProps = {},
      onView,
      formSettings,
      ...props
    }: any) => {
      const errorId = useId();
      const hasError = Boolean(inlineError && !componentOnly);
      const showInlineError = hasError && formSettings?.errorType !== 'html5';
      const errorAttributes: React.AriaAttributes = {
        'aria-invalid': hasError || undefined,
        'aria-describedby':
          [elementProps['aria-describedby'], showInlineError && errorId]
            .filter(Boolean)
            .join(' ') || undefined
      };
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
            inlineError={inlineError}
            errorAttributes={errorAttributes}
            elementProps={{
              ...elementProps,
              ...(showInlineError && { 'data-feathery-error-id': errorId })
            }}
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
            {showInlineError && (
              <span
                id={errorId}
                data-feathery-error-label={
                  element.servar?.name || element.properties?.aria_label || ''
                }
                css={{
                  alignSelf: 'flex-start',
                  flexShrink: 0,
                  marginTop: '4px',
                  overflowWrap: 'anywhere',
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
