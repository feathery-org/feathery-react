import React from 'react';
import WarningIcon from '../elements/components/icons/Warning';
import { removeStytchQueryParams } from '../integrations/stytch';
import { featheryWindow } from '../utils/browser';

export default function LoginError() {
  return (
    <div
      style={{
        width: '350px',
        height: '230px',
        backgroundColor: 'rgba(0, 0, 0, 0.08)',
        borderRadius: '16px',
        textAlign: 'center',
        fontSize: '1.2rem',
        padding: '30px 20px',
        margin: '30px auto',
        boxSizing: 'border-box'
      }}
    >
      <i style={{ fontSize: '2.6rem' }}>
        <WarningIcon width={32} height={32} />
      </i>
      <h2
        style={{
          fontSize: '1.8rem',
          fontWeight: 400,
          marginBlock: '10px 30px'
        }}
      >
        Your magic link expired
      </h2>
      <button
        onClick={() => {
          removeStytchQueryParams();
          featheryWindow().location.reload();
        }}
        style={{
          display: 'block',
          margin: '10px auto',
          cursor: 'pointer',
          fontSize: '1.2rem',
          padding: '1px 6px',
          border: '2px outset buttonborder',
          borderRadius: '4px'
        }}
      >
        Log in
      </button>
    </div>
  );
}
