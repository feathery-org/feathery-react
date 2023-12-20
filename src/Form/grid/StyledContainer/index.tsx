import React, { PropsWithChildren, forwardRef } from 'react';
import {
  useContainerEngine,
  useContainerStyles,
  useFormattedNode,
  useNodeType
} from './hooks';
import { FORM_Z_INDEX } from '../../../utils/styles';
import { getCellStyle } from './styles';
import { useFixedContainer } from './hooks/useFixedContainer';
import classNames from 'classnames';

export type StyledContainerProps = PropsWithChildren & {
  key?: string;
  node: any;
  raw?: any;
  css?: any;
  component?: any;
  viewport?: 'desktop' | 'mobile';
  [key: string]: any;
  viewportOnly?: boolean;
};

/**
 * StyledContainer
 * This component applies all of the style properties to "Containers" which are used
 * around elements and other "Containers". This component is used by both hosted forms
 * and the editor to render "Containers".
 */
export const StyledContainer = forwardRef<HTMLDivElement, StyledContainerProps>(
  (
    {
      node: _node,
      raw,
      css = {},
      viewport,
      component,
      children,
      className,
      viewportOnly = false,
      ...props
    },
    ref
  ) => {
    const { node, rawNode } = useFormattedNode(_node, raw);
    const type = useNodeType(node, rawNode, viewport);

    const { styles, innerStyles, isFixed } = useContainerStyles(
      node,
      rawNode,
      css,
      viewportOnly ? viewport : undefined
    );

    useContainerEngine(node, rawNode, ref);

    const fixedContainerRef = useFixedContainer(node, rawNode, isFixed);

    if (component) {
      const Component = component;

      return (
        <Component
          key={node.id}
          ref={ref}
          node={_node}
          css={styles}
          className={classNames('styled-container', type, className)}
          {...props}
        >
          {/* An inner container is required to properly size px-height
            elements as the outer container is dependent on content size. */}
          <div className='inner-container' css={innerStyles}>
            {children}
          </div>
        </Component>
      );
    }

    return (
      <>
        {isFixed && (
          <div
            key={`${node.id}-fixed`}
            className={classNames('styled-container', type, className)}
            {...props}
            css={{
              ...styles,
              position: 'fixed',
              zIndex: FORM_Z_INDEX + 1
            }}
            ref={fixedContainerRef}
          >
            <div className='inner-container' css={innerStyles}>
              {children}
            </div>
          </div>
        )}
        <div
          key={node.id}
          ref={ref}
          css={isFixed ? { ...styles, visibility: 'hidden' } : styles}
          className={classNames('styled-container', type, className)}
          data-id={node.id}
          {...props}
        >
          {/* An inner container is required to properly size px-height
            elements as the outer container is dependent on content size. */}
          <div className='inner-container' css={innerStyles}>
            {isFixed ? null : children}
          </div>
        </div>
      </>
    );
  }
);

export { getCellStyle };
