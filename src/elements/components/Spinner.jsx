import React, { memo } from 'react';
import Spinner from 'react-bootstrap/Spinner';

function FeatherySpinner() {
  return (
    <Spinner
      animation='border'
      style={{
        color: 'white',
        border: '0.2em solid currentColor',
        borderRightColor: 'transparent',
        boxSizing: 'border-box',
        width: '100%',
        height: '100%'
      }}
      css={{
        '@-webkit-keyframes spinner-border': {
          to: {
            WebkitTransform: 'rotate(360deg)',
            transform: 'rotate(360deg)'
          }
        },
        '@keyframes spinner-border': {
          to: {
            WebkitTransform: 'rotate(360deg)',
            transform: 'rotate(360deg)'
          }
        },
        '&.spinner-border': {
          display: 'block',
          borderRadius: '50%',
          animation: '0.75s linear infinite spinner-border'
        }
      }}
    />
  );
}

export default memo(FeatherySpinner);
