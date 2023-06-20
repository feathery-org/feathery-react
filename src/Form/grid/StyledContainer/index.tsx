import React, { PropsWithChildren, forwardRef } from 'react';
import {
  useContainerEngine,
  useContainerStyles,
  useFormattedNode,
  useNodeType
} from './hooks';
import { getCellStyle } from './styles';
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
    const { styles, innerStyles } = useContainerStyles(
      node,
      rawNode,
      css,
      viewportOnly ? viewport : undefined
    );

    useContainerEngine(node, rawNode, ref);

    if (component) {
      const Component = component;

      return (
        <Component
          ref={ref}
          node={_node}
          css={styles}
          className={classNames('styled-container', type, className)}
          {...props}
        >
          <div className='inner-container' css={innerStyles}>
            {children}
          </div>
        </Component>
      );
    }

    return (
      <div
        ref={ref}
        css={styles}
        className={classNames('styled-container', type, className)}
        {...props}
      >
        <div className='inner-container' css={innerStyles}>
          {children}
        </div>
      </div>
    );
  }
);

export { getCellStyle };
