import React, { memo } from 'react';
import { featheryDoc } from '../../utils/browser';

const keyframes = {
  '@keyframes feathery-spinner-rotate': {
    to: { transform: 'rotate3d(0, 0, 1, 360deg)' }
  },
  '@keyframes feathery-spinner-arc': {
    from: { 'stroke-dasharray': '0 150', 'stroke-dashoffset': 0 },
    to: { 'stroke-dasharray': '100 150', 'stroke-dashoffset': -140 }
  }
};

const keyframesCSS = Object.entries(keyframes)
  .map(([selector, rules]) => {
    const ruleSet = Object.entries(rules)
      .map(([key, properties]) => {
        const propertySet = Object.entries(properties)
          .map(([property, value]) => `${property}:${value}`)
          .join(';');
        return `${key} { ${propertySet} }`;
      })
      .join('');
    return `${selector} { ${ruleSet} }`;
  })
  .join('');

const styleElement = featheryDoc().createElement('style');
styleElement.id = 'feathery-spinner-styles';
styleElement.textContent = keyframesCSS;
// inject keyframes into the DOM without using styled-components
featheryDoc().head.appendChild(styleElement);

function FeatherySpinner() {
  const spinnerSize = 4;
  const lineColor = '#333849';
  const lineAlpha = 1;
  const ringColor = '#DBDFE8';
  const ringAlpha = 1;
  const ringSize = 2;
  return (
    <svg
      viewBox='0 0 50 50'
      style={{
        fontSize: `calc(${spinnerSize} * 1em)`,
        width: '1em',
        height: '1em',
        borderRadius: '50%'
      }}
    >
      <circle
        style={{
          fill: 'none',
          stroke: lineColor,
          strokeWidth: ringSize,
          opacity: lineAlpha,
          strokeLinecap: 'round',
          transformOrigin: '50% 50%',
          transform: 'rotate3d(0, 0, 1, 0deg)',
          animation:
            '2156ms feathery-spinner-arc ease-in-out infinite, 1829ms feathery-spinner-rotate linear infinite'
        }}
        cx='25'
        cy='25'
        r='22.5'
      />
      <circle
        style={{
          fill: 'none',
          stroke: ringColor,
          strokeWidth: ringSize,
          opacity: ringAlpha
        }}
        cx='25'
        cy='25'
        r='22.5'
      />
    </svg>
  );
}

export default memo(FeatherySpinner);
