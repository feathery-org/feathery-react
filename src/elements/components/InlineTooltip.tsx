import React from 'react';
import { OverlayTrigger, Tooltip } from 'react-bootstrap';
import { HelpIcon } from './icons';
import { FORM_Z_INDEX } from '../../utils/styles';

export default function InlineTooltip({
  id,
  text,
  responsiveStyles,
  absolute = true
}: any) {
  return text ? (
    <OverlayTrigger
      placement='auto'
      flip
      trigger={['hover', 'click']}
      rootClose
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
                right: '10px',
                top: 0,
                bottom: 0,
                zIndex: FORM_Z_INDEX,
                margin: 'auto',
                cursor: 'pointer',
                height: '100%'
              }
            : { marginLeft: '8px', marginTop: '3px' }
        }
      >
        <HelpIcon cssStyles={responsiveStyles.getTarget('tooltipIcon')} />
      </div>
    </OverlayTrigger>
  ) : null;
}
