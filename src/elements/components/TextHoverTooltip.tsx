import React from 'react';
import { OverlayTrigger, Tooltip } from 'react-bootstrap';

export default function TextHoverTooltip({ text, children }: any) {
  return text ? (
    <OverlayTrigger
      overlay={
        <Tooltip
          id={`tooltip-${text}`}
          css={{
            zIndex: 2,
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
      {children}
    </OverlayTrigger>
  ) : (
    children
  );
}
