import React, {
  PropsWithChildren,
  forwardRef,
  useEffect,
  useMemo,
  useRef
} from 'react';
import {
  useContainerEngine,
  useContainerStyles,
  useFormattedNode,
  useNodeType
} from './hooks';
import { getCellStyle } from './styles';
import classNames from 'classnames';
import { featheryDoc } from '../../../utils/browser';

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
    const fixedContainerRef = useRef<HTMLDivElement>(null);
    const nodeRef = useRef(node || rawNode);
    const getNode = () => (nodeRef.current ? nodeRef.current : node || rawNode);

    const { styles, innerStyles, isFixed } = useContainerStyles(
      node,
      rawNode,
      css,
      viewportOnly ? viewport : undefined
    );

    useContainerEngine(node, rawNode, ref);

    useEffect(() => {
      nodeRef.current = node || rawNode;
    }, [node, rawNode]);

    useEffect(() => {
      let _node = getNode();

      if (_node.uuid || !isFixed) {
        return; // Disable all fixed behaviour on the editor
      }

      if (fixedContainerRef.current) {
        const doc = featheryDoc();
        const container = doc.querySelector(`div[data-id="${_node.id}"]`);

        if (container) {
          // If the container is the first child of root, top/left will be 0
          // If the container is the last child of root, bottom/left will be 0
          // If the container is none of the above, top/left will be taken from the container
          // Width will be taken from the container

          const setPositionAndDimensions = () => {
            if (!fixedContainerRef.current || !container) {
              return;
            }

            _node = getNode();

            const { top, left } = container.getBoundingClientRect();
            const isParentRoot = !_node.parent.parent;
            const isFirstChild = _node.parent.children[0].id === _node.id;
            const isLastChild =
              _node.parent.children[_node.parent.children.length - 1].id ===
              _node.id;

            if (isParentRoot && isFirstChild) {
              fixedContainerRef.current.style.top = '0';
              fixedContainerRef.current.style.left = `${left}px`;
            }

            if (isParentRoot && isLastChild) {
              fixedContainerRef.current.style.bottom = '0';
              fixedContainerRef.current.style.left = `${left}px`;
            }

            if (!isParentRoot || (!isFirstChild && !isLastChild)) {
              fixedContainerRef.current.style.top = `${top}px`;
              fixedContainerRef.current.style.left = `${left}px`;
            }

            fixedContainerRef.current.style.height = `${container.offsetHeight}px`;
            fixedContainerRef.current.style.width = `${container.offsetWidth}px`;
          };

          setPositionAndDimensions();

          let resizeObserver: any = new ResizeObserver(() =>
            setPositionAndDimensions()
          );

          let parentResizeObserver: any = new ResizeObserver(() =>
            setPositionAndDimensions()
          );

          resizeObserver.observe(container);
          parentResizeObserver.observe(doc.querySelector('body'));

          return () => {
            resizeObserver.disconnect();
            resizeObserver = null;

            parentResizeObserver.disconnect();
            parentResizeObserver = null;
          };
        }
      }
    }, [isFixed]);

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
              zIndex: 50
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
