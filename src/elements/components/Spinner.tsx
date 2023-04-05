import React, { memo } from 'react';
import './Spinner.css';

function FeatherySpinner() {
  // Things didn't render properly when using styles + css properties, so just used CSS file.
  // All classes and animations have feathery- at the start to avoid naming conflicts with end users
  return (
    <svg viewBox='0 0 50 50' className='feathery-spinner'>
      <circle className='feathery-spinner-ring' cx='25' cy='25' r='22.5' />
      <circle className='feathery-spinner-line' cx='25' cy='25' r='22.5' />
    </svg>
  );
}

export default memo(FeatherySpinner);
