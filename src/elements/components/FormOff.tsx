import React from 'react';
import { FormClosedIcon } from './icons';
import { openTab } from '../../utils/browser';

export default function FormOff({
  width = 500,
  noEdit = false,
  showCTA = true
}) {
  const message = noEdit
    ? 'You have successfully filled out the form.'
    : "This form isn't currently collecting responses.";
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
          width: `${width}px`,
          fontWeight: 600,
          fontSize: '26px',
          lineHeight: '32px',
          textAlign: 'center',
          margin: '50px 0'
        }}
      >
        {message}
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
