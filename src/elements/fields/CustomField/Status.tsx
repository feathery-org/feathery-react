import React from 'react';

const Placeholder = () => (
  <div
    style={{
      padding: '16px',
      border: '2px dashed #d1d5db',
      borderRadius: '4px',
      textAlign: 'center'
    }}
  >
    <div style={{ color: '#4b5563' }}>
      <div style={{ fontSize: '14px' }}>Custom Component</div>
      <div style={{ fontSize: '12px', marginTop: '4px' }}>No code provided</div>
    </div>
  </div>
);

const Loading = () => (
  <div
    style={{
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      padding: '8px',
      backgroundColor: '#dbeafe',
      color: '#2563eb',
      fontSize: '14px'
    }}
  >
    Loading...
  </div>
);

const Error = ({ error }: { error: string }) => (
  <div
    style={{
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      padding: '8px',
      backgroundColor: '#fee2e2',
      color: '#dc2626',
      fontSize: '14px'
    }}
  >
    Error: {error}
  </div>
);

export default { Placeholder, Loading, Error };
