import React, { useState } from 'react';
import { OverlayTrigger, Tooltip } from 'react-bootstrap';
import { HelpIcon } from './icons';
import { FORM_Z_INDEX } from '../../utils/styles';
import { replaceTextVariables } from './TextNodes';

export default function InlineTooltip({
  id,
  text,
  responsiveStyles,
  absolute = true,
  container,
  repeat
}: any) {
  // Explicitly managing popover state prevents a bug on mobile where
  // tooltip needs to be pressed twice to show
  const [show, setShow] = useState(false);

  text = replaceTextVariables(text, repeat);
  return text ? (
    <OverlayTrigger
      placement='auto'
      flip
      show={show}
      onToggle={() => setShow(!show)}
      trigger={['hover', 'click', 'focus']}
      rootClose
      container={() => container?.current}
      overlay={
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
      }
    >
      <div
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
                height: '100%'
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
    </OverlayTrigger>
  ) : null;
}
