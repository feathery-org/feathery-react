import React, { PropsWithChildren, forwardRef, useMemo } from 'react';
import { getContainerStyles, getCellStyle, DEFAULT_MIN_SIZE } from './styles';
import { formatContainerStyles } from './transform';
import { getRawNode } from './utils';

export type StyledContainerProps = PropsWithChildren & {
  node: any;
  raw?: any;
  css?: any;
  component?: any;
  viewport?: 'desktop' | 'mobile';
  [key: string]: any;
};

/**
 * StyledContainer
 * This component applies all of the style properties to "Containers" which are used
 * around elements and other "Containers". This component is used by both hosted forms
 * and the editor to render "Containers".
 */
export const StyledContainer = forwardRef<HTMLDivElement, StyledContainerProps>(
  (
    { node: _node, raw, css = {}, viewport, component, children, ...props },
    ref
  ) => {
    const [node, rawNode] = useMemo(() => {
      const targetNode = raw ?? getRawNode(_node);
      const nodeStyles = formatContainerStyles(_node);
      const rawNode = {
        ...targetNode,
        styles: {
          ...targetNode.styles,
          ...nodeStyles.styles
        },
        mobile_styles: {
          ...targetNode.styles,
          ...nodeStyles.mobile_styles
        }
      };

      return _node.model || _node.element
        ? [_node, rawNode]
        : [rawNode, undefined];
    }, [_node, raw]);

    const styles = useMemo(() => {
      const [cellStyle = {}] = node.isElement
        ? [{}]
        : getCellStyle(rawNode ?? node, viewport);

      const _styles = {
        position: 'relative',
        display: 'flex',
        minWidth: !node.isElement ? `${DEFAULT_MIN_SIZE}px` : 'min-content',
        minHeight: !node.isElement ? `${DEFAULT_MIN_SIZE}px` : 'min-content',
        boxSizing: 'border-box',
        ...css,
        ...getContainerStyles(node, rawNode, viewport),
        ...cellStyle
      };

      if (node.isElement) {
        _styles.flexDirection = 'column';
      }

      return _styles;
    }, [node, rawNode, css]);

    if (component) {
      const Component = component;

      return (
        <Component ref={ref} node={_node} css={styles} {...props}>
          {children}
        </Component>
      );
    }

    return (
      <div ref={ref} css={styles} {...props}>
        {children}
      </div>
    );
  }
);

export { getCellStyle };
