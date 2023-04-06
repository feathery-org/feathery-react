import React from 'react';

export default function Watermark({
  show,
  addChin,
  brandPosition = 'bottom_right',
  width = 135,
  height = 40
}: any) {
  const horizontalAlignment = brandPosition.endsWith('right')
    ? { right: 0 }
    : { left: 0 };
  const verticalAlignment = brandPosition.startsWith('bottom')
    ? { bottom: addChin ? -60 : 0 }
    : { top: 0 };

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
        position: 'absolute',
        ...horizontalAlignment,
        ...verticalAlignment
      }}
    >
      {anchorWrap(
        <div
          css={{
            width: `${width}px`,
            height: `${height}px`,
            marginRight: '5px',
            marginBottom: '5px',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            background: '#FFFFFF',
            boxShadow: '0px 2px 10px rgba(151, 161, 172, 0.3)',
            borderRadius: '6px',
            color: '#6c7589',
            fontFamily: 'Axiforma, sans-serif',
            fontSmoothing: 'antialiased',
            fontWeight: 400,
            fontSize: '11px',
            gap: '8px',
            cursor: 'pointer'
          }}
        >
          Built on
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
