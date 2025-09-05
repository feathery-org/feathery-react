import React, { useState, useRef } from 'react';
import { Tooltip } from './Tooltip';
import { FORM_Z_INDEX } from '../../utils/styles';
import Overlay from './Popover';

interface TextHoverTooltipProps {
  text: string;
  children: React.ReactNode;
}

export default function TextHoverTooltip({
  text,
  children
}: TextHoverTooltipProps) {
  const [show, setShow] = useState(false);
  const triggerRef = useRef<HTMLElement>(null);

  if (!text) return <>{children}</>;

  return (
    <>
      <span
        ref={triggerRef}
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onFocus={() => setShow(true)}
        onBlur={() => setShow(false)}
        onClick={() => setShow((prev) => !prev)}
        style={{ display: 'inline-block', cursor: 'pointer' }}
      >
        {children}
      </span>

      <Overlay
        show={show}
        target={triggerRef.current}
        placement='top'
        onHide={() => setShow(false)}
        offset={4}
      >
        <Tooltip
          id={`tooltip-${text}`}
          css={{
            zIndex: FORM_Z_INDEX + 1,
            padding: '.4rem 0',
            margin: '0 1rem',
            transition: 'opacity .10s linear',
            '.tooltip-inner': {
              maxWidth: '200px',
              padding: '.25rem .5rem',
              color: '#fff',
              textAlign: 'center',
              backgroundColor: '#000',
              borderRadius: '.25rem',
              fontSize: 'smaller'
            }
          }}
        >
          {text}
        </Tooltip>
      </Overlay>
    </>
  );
}
