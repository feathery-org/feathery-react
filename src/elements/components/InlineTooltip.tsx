import React from 'react';
import { OverlayTrigger, Tooltip } from 'react-bootstrap';
import { HelpIcon } from './icons';
import { FORM_Z_INDEX } from '../../utils/styles';

export default function InlineTooltip({ element, responsiveStyles }: any) {
  const text = element.properties.tooltipText;
  return text ? (
    <OverlayTrigger
      placement='top-end'
      trigger={['hover', 'click']}
      rootClose
      overlay={
        <Tooltip
          id={`tooltip-${element.id}`}
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
        css={{
          position: 'absolute',
          right: '10px',
          top: 0,
          bottom: 0,
          zIndex: FORM_Z_INDEX,
          margin: 'auto',
          cursor: 'pointer',
          height: '100%'
        }}
      >
        <HelpIcon
          cssStyles={{
            ...responsiveStyles.getTarget('tooltipIcon')
          }}
        />
      </div>
    </OverlayTrigger>
  ) : null;
}
