import React, { useState, useRef } from 'react';
import { Tooltip } from './Tooltip';
import { HelpIcon } from './icons';
import { FORM_Z_INDEX } from '../../utils/styles';
import { replaceTextVariables } from './TextNodes';
import Overlay from './Popover';
import { isMobile as _isMobile } from '../../utils/browser';

interface InlineTooltipProps {
  id: string;
  text: string;
  responsiveStyles: any;
  absolute?: boolean;
  container?: React.RefObject<HTMLElement>;
  repeat?: any;
}

export default function InlineTooltip({
  id,
  text,
  responsiveStyles,
  absolute = true,
  repeat
}: InlineTooltipProps) {
  const [show, setShow] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);

  text = replaceTextVariables(text, repeat);

  if (!text) return null;

  const isMobile = _isMobile();

  return (
    <>
      <div
        ref={triggerRef}
        // this prevents needing to click twice on mobile
        onMouseEnter={isMobile ? undefined : () => setShow(true)}
        onMouseLeave={isMobile ? undefined : () => setShow(false)}
        onFocus={() => setShow(true)}
        onBlur={() => setShow(false)}
        onClick={() => setShow((prev) => !prev)}
        css={
          absolute
            ? {
                position: 'absolute',
                insetInlineEnd: '10px',
                top: 0,
                bottom: 0,
                zIndex: FORM_Z_INDEX,
                margin: 'auto',
                cursor: 'pointer',
                height: '100%',
                display: 'flex'
              }
            : {
                position: 'relative',
                marginInlineStart: '8px',
                display: 'flex',
                alignItems: 'center'
              }
        }
      >
        <HelpIcon cssStyles={responsiveStyles.getTarget('tooltipIcon')} />
      </div>

      <Overlay
        show={show}
        target={triggerRef.current}
        placement='left'
        onHide={() => setShow(false)}
        offset={8}
      >
        <Tooltip
          id={`tooltip-${id}`}
          css={{
            zIndex: FORM_Z_INDEX + 1,
            padding: '.4rem 0',
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
