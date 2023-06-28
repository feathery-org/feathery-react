import React, { forwardRef, memo, Ref, useLayoutEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { featheryDoc, featheryWindow } from '../utils/browser';

type ElevatedMenuProps = React.PropsWithChildren<{
  className?: string;
  styles?: any;
  show?: boolean;
  position: {
    x: number;
    y: number;
  };
  anchor?: 'top_left' | 'top_right' | 'bottom_left' | 'bottom_right';
  bestFit?: boolean;
  relativeParent?: HTMLElement;
}>;

function ElevatedMenu(
  {
    className = '',
    styles: customStyles = {},
    show,
    position,
    anchor = 'top_left',
    bestFit = false,
    children,
    relativeParent
  }: ElevatedMenuProps,
  ref: Ref<HTMLDivElement>
) {
  const fullStyle = {
    ...customStyles,
    position: 'absolute',
    zIndex: 1000,
    top: ['top_left', 'top_right'].includes(anchor) ? position.y : undefined,
    left: ['top_left', 'bottom_left'].includes(anchor) ? position.x : undefined,
    bottom: ['bottom_left', 'bottom_right'].includes(anchor)
      ? featheryWindow().innerHeight - position.y
      : undefined,
    right: ['top_right', 'bottom_right'].includes(anchor)
      ? featheryWindow().innerWidth - position.x
      : undefined
  };
  if (position.x === undefined && position.y === undefined) {
    fullStyle.display = 'none';
  }

  const containerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (bestFit && containerRef && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      // For now just checking that it fits vertically and horizontally and only that it is not cut-off on the bottom/right.
      if (rect.right > featheryWindow().innerWidth) {
        containerRef.current.style.right = '';
        containerRef.current.style.left = `${position.x - rect.width}px`;
      }
      if (rect.bottom > featheryWindow().innerHeight) {
        containerRef.current.style.bottom = '';
        containerRef.current.style.top = `${position.y - rect.height}px`;
      }
    }
  }, [position, bestFit, containerRef]);

  const rootEl = relativeParent ?? featheryDoc().body;

  return ReactDOM.createPortal(
    show ? (
      <div id='elevated-menu-container' ref={ref}>
        <div ref={containerRef} className={className} style={fullStyle}>
          {children}
        </div>
      </div>
    ) : null,
    rootEl
  );
}

export default memo(
  forwardRef<HTMLDivElement, ElevatedMenuProps>(ElevatedMenu as any)
);
