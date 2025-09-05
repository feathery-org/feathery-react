import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { featheryDoc } from '../../utils/browser';

const OverlayTrigger = ({
  placement = 'auto',
  show: controlledShow,
  onToggle,
  trigger = ['hover'],
  rootClose = false,
  container,
  overlay,
  children,
  offset = 5
}) => {
  const [show, setShow] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef(null);
  const tooltipRef = useRef(null);

  const isControlled = controlledShow !== undefined;
  const isShown = isControlled ? controlledShow : show;

  const handleShow = () => {
    if (isControlled) {
      onToggle?.();
    } else {
      setShow(true);
    }
  };

  const handleHide = () => {
    if (isControlled) {
      onToggle?.();
    } else {
      setShow(false);
    }
  };

  useEffect(() => {
    if (triggerRef.current && tooltipRef.current && isShown) {
      const rect = triggerRef.current.getBoundingClientRect();
      const tooltipRect = tooltipRef.current.getBoundingClientRect();
      const containerRect = container?.()?.getBoundingClientRect() || {
        top: 0,
        left: 0
      };

      let top =
        rect.top - containerRect.top + (rect.height - tooltipRect.height) / 2;
      let left = rect.left - containerRect.left - tooltipRect.width - 5;

      if (placement === 'bottom') {
        top = rect.bottom - containerRect.top + 5;
        left =
          rect.left - containerRect.left + (rect.width - tooltipRect.width) / 2;
      } else if (placement === 'bottom-start') {
        top = rect.bottom - containerRect.top + 5;
        left = rect.left - containerRect.left;
      } else if (placement === 'top') {
        top = rect.top - containerRect.top - tooltipRect.height - 5;
        left =
          rect.left - containerRect.left + (rect.width - tooltipRect.width) / 2;
      } else if (placement === 'right') {
        top =
          rect.top - containerRect.top + (rect.height - tooltipRect.height) / 2;
        left = rect.right - containerRect.left + 5;
      }

      setPosition({ top, left });
    }
  }, [isShown, container, placement]);

  useEffect(() => {
    if (rootClose && isShown) {
      const handleClickOutside = (event) => {
        if (
          triggerRef.current &&
          !triggerRef.current.contains(event.target) &&
          tooltipRef.current &&
          !tooltipRef.current.contains(event.target)
        ) {
          handleHide();
        }
      };

      featheryDoc().addEventListener('mousedown', handleClickOutside);
      return () =>
        featheryDoc().removeEventListener('mousedown', handleClickOutside);
    }
  }, [isShown, rootClose]);

  const triggerProps = {};

  if (trigger.includes('hover')) {
    triggerProps.onMouseEnter = handleShow;
    triggerProps.onMouseLeave = handleHide;
  }

  if (trigger.includes('click')) {
    triggerProps.onClick = isShown ? handleHide : handleShow;
  }

  if (trigger.includes('focus')) {
    triggerProps.onFocus = handleShow;
    triggerProps.onBlur = handleHide;
  }

  const portalContainer = container ? container() : featheryDoc().body;

  return (
    <>
      {React.cloneElement(children, {
        ...triggerProps,
        ref: (node) => {
          triggerRef.current = node;
          if (typeof children.ref === 'function') {
            children.ref(node);
          } else if (children.ref) {
            children.ref.current = node;
          }
        }
      })}
      {isShown &&
        portalContainer &&
        createPortal(
          <div
            ref={tooltipRef}
            style={{
              position: 'absolute',
              top: position.top,
              left: position.left,
              pointerEvents: 'none'
            }}
          >
            {overlay}
          </div>,
          portalContainer
        )}
    </>
  );
};

export { OverlayTrigger };
