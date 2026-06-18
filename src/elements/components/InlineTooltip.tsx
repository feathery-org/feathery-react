import React, { useState, useRef } from 'react';
import { HelpIcon } from './icons';
import { FORM_Z_INDEX } from '../../utils/styles';
import { replaceTextVariables } from './TextNodes';
import HoverTooltip from './HoverTooltip';
import { isMobile as _isMobile } from '../../utils/browser';

interface InlineTooltipProps {
  id: string;
  text: string;
  responsiveStyles: any;
  absolute?: boolean;
  containerRef?: React.RefObject<HTMLElement | null>;
  repeat?: any;
}

export default function InlineTooltip({
  id,
  text,
  responsiveStyles,
  absolute = true,
  containerRef,
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

      <HoverTooltip
        show={show}
        triggerRef={triggerRef}
        containerRef={containerRef}
        text={text}
        id={id}
        placement='left'
        offset={8}
        onHide={() => setShow(false)}
      />
    </>
  );
}
