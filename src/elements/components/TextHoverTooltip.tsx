import React from 'react';
import { Tooltip } from './Tooltip';
import { FORM_Z_INDEX } from '../../utils/styles';
import { OverlayTrigger } from './Overlay';

export default function TextHoverTooltip({ text, children, container }: any) {
  return text ? (
    <OverlayTrigger
      placement='auto'
      container={() => container?.current}
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
