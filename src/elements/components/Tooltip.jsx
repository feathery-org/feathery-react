import React from 'react';
import { OverlayTrigger, Tooltip } from 'react-bootstrap';
import { HelpIcon } from './icons';

export default function InlineTooltip({ id, text, applyStyles }) {
    return (
        <OverlayTrigger
            placement='top-end'
            trigger='click'
            rootClose
            overlay={
                <Tooltip
                    id={`tooltip-${id}`}
                    css={{
                        opacity: 0.9,
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
            <HelpIcon
                cssStyles={{
                    position: 'absolute',
                    right: '10px',
                    top: 0,
                    bottom: 0,
                    margin: 'auto',
                    cursor: 'pointer',
                    height: '100%',
                    ...applyStyles.getTarget('tooltipIcon')
                }}
            />
        </OverlayTrigger>
    );
}
