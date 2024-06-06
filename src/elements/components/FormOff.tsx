import React from 'react';
import { FormClosedIcon } from './icons';
import { openTab } from '../../utils/browser';

export const FILLED_OUT = 'filled_out';
export const CLOSED = 'closed';
export const COLLAB_COMPLETED = 'collab_completed';
export const NO_BUSINESS_EMAIL = 'no_business_email';
const messages: any = {
  [FILLED_OUT]: 'You have successfully filled out the form.',
  [CLOSED]: "This form isn't currently collecting responses.",
  [COLLAB_COMPLETED]: 'Your collaboration group has completed this form.',
  [NO_BUSINESS_EMAIL]:
    'Activate this form by inviting a business domain email to your Feathery account and accepting'
};

export default function FormOff({
  width = 400,
  reason = CLOSED,
  showCTA = true
}) {
  return (
    <div
      css={{
        width: '100%',
        height: '100%',
        minHeight: '50vh',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'white'
      }}
    >
      <FormClosedIcon width={width} />
      <div
        css={{
          maxWidth: `${width}px`,
          fontWeight: 600,
          fontSize: '26px',
          lineHeight: '32px',
          textAlign: 'center',
          margin: '50px 0'
        }}
      >
        {messages[reason]}
      </div>
      {showCTA && (
        <button
          css={{
            border: '1px solid #e2626e',
            color: '#e2626e',
            outline: 'none',
            backgroundColor: 'white',
            padding: '10px 20px',
            cursor: 'pointer',
            borderRadius: '10px',
            fontSize: '18px'
          }}
          onClick={() => openTab('https://feathery.io')}
        >
          Create a Feathery form
        </button>
      )}
    </div>
  );
}
