import React from 'react';
import { OverlayTrigger, Tooltip } from 'react-bootstrap';
import { FORM_Z_INDEX } from '../../utils/styles';

export default function TextHoverTooltip({ text, children }: any) {
  return text ? (
    <OverlayTrigger
      placement='auto'
      flip
      overlay={
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
      }
    >
      {children}
    </OverlayTrigger>
  ) : (
    children
  );
}
