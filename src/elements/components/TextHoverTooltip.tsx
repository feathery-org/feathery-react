import React, { useState, useRef, RefObject } from 'react';
import HoverTooltip from './HoverTooltip';
import { isMobile as _isMobile } from '../../utils/browser';

interface TextHoverTooltipProps {
  text: string;
  children: React.ReactNode;
  containerRef?: RefObject<HTMLElement>;
}

export default function TextHoverTooltip({
  text,
  children,
  containerRef
}: TextHoverTooltipProps) {
  const [show, setShow] = useState(false);
  const triggerRef = useRef<HTMLElement>(null);

  if (!text) return <>{children}</>;

  const isMobile = _isMobile();

  return (
    <>
      <span
        ref={triggerRef}
        onMouseEnter={isMobile ? undefined : () => setShow(true)}
        onMouseLeave={isMobile ? undefined : () => setShow(false)}
        onFocus={() => setShow(true)}
        onBlur={() => setShow(false)}
        onClick={() => setShow((prev) => !prev)}
        style={{ display: 'inline-block', cursor: 'pointer' }}
      >
        {children}
      </span>

      <HoverTooltip
        show={show}
        triggerRef={triggerRef}
        containerRef={containerRef}
        text={text}
        id={text}
        placement='top'
        offset={4}
        onHide={() => setShow(false)}
        css={{ margin: '0 1rem' }}
      />
    </>
  );
}
