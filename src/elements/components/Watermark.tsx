import React from 'react';

export default function Watermark({
  show,
  brandPosition = 'bottom_right',
  width = 150,
  height = 35
}: any) {
  const horizontalAlignment = brandPosition.endsWith('right')
    ? { right: 15 }
    : { left: 15 };
  const verticalAlignment = brandPosition.startsWith('bottom')
    ? { bottom: 15 }
    : { top: 15 };

  const anchorWrap = (children?: any) => {
    return (
      /* eslint-disable-next-line react/jsx-no-target-blank  */
      <a
        href='https://feathery.io'
        target='_blank'
        css={{ textDecoration: 'none' }}
        rel='noopener'
      >
        {children}
      </a>
    );
  };

  return show ? (
    <div
      css={{
        position: 'fixed',
        zIndex: 1000,
        ...horizontalAlignment,
        ...verticalAlignment
      }}
    >
      {anchorWrap(
        <div
          css={{
            width: `${width}px`,
            height: `${height}px`,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            background: '#FFFFFF',
            boxShadow: '0px 0px 8px rgba(151, 161, 172, 0.4)',
            borderRadius: '6px',
            color: '#6c7589',
            fontFamily: 'Axiforma, sans-serif',
            fontSmoothing: 'antialiased',
            fontWeight: 500,
            fontSize: '11px',
            gap: '8px',
            cursor: 'pointer'
          }}
        >
          Form by
          <img
            css={{ maxWidth: '50%', maxHeight: '80%', paddingBottom: '1px' }}
            src='https://feathery.s3.us-west-1.amazonaws.com/full-logo-1.png'
            alt='Feathery Logo'
          />
        </div>
      )}
    </div>
  ) : (
    anchorWrap()
  );
}
