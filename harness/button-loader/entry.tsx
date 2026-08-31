// Harness entry: renders real ButtonElements in a browser so the loader's
// SIZE can be measured.
//
// This exists because jsdom has no layout engine. Every automated test for the
// loader can prove which branch was taken - overlay vs. direct child - but not
// the thing that actually broke: whether the loader ends up big enough to see.
// The clamp is `max-width: 100%` against the button's content box, so it only
// misbehaves once a real browser has resolved that box. Everything here is the
// shipped component, no forks and no fakes.
//
// Not part of the package build. See harness/button-loader/README.md.

import React from 'react';
import { createRoot } from 'react-dom/client';

// The package entry first, on purpose. ButtonElement sits in the middle of a
// cycle (TextNodes -> utils/init -> LoginForm -> Form), so entering the graph
// at ButtonElement evaluates those modules in an order production never uses
// and trips a TDZ. Starting at src/index reproduces the real init order.
import '../../src/index';

import ButtonElement from '../../src/elements/basic/ButtonElement';
import ResponsiveStyles from '../../src/elements/styles';
import FeatherySpinner from '../../src/elements/components/Spinner';

const BASE_STYLES = {
  flex_direction: 'row',
  text_align: 'center',
  height: 40,
  height_unit: 'px',
  background_color: 'e4e7ec',
  border_top_color: '667085',
  border_right_color: '667085',
  border_bottom_color: '667085',
  border_left_color: '667085',
  border_top_width: 1,
  border_right_width: 1,
  border_bottom_width: 1,
  border_left_width: 1,
  border_top_pattern: 'solid',
  border_right_pattern: 'solid',
  border_bottom_pattern: 'solid',
  border_left_pattern: 'solid',
  uploader_padding_top: 8,
  uploader_padding_right: 12,
  uploader_padding_bottom: 8,
  uploader_padding_left: 12
};

const makeElement = (id: string, properties: any) => ({
  id,
  properties: { submit: false, actions: [{ type: 'next' }], ...properties },
  styles: BASE_STYLES,
  repeat: null
});

const CASES = [
  {
    key: 'empty-label-idle',
    label: "Label renders empty (data source -> '') - idle",
    element: makeElement('empty-label-idle', {
      text: 'Placeholder label',
      text_formatted: [{ insert: 'Placeholder label' }],
      text_mode: 'data',
      text_source: 'feathery.empty'
    }),
    featheryContext: { empty: '' },
    loading: false
  },
  {
    key: 'empty-label-loading',
    label: "Label renders empty - LOADING  <-- the case under test",
    element: makeElement('empty-label-loading', {
      text: 'Placeholder label',
      text_formatted: [{ insert: 'Placeholder label' }],
      text_mode: 'data',
      text_source: 'feathery.empty'
    }),
    featheryContext: { empty: '' },
    loading: true
  },
  {
    key: 'whitespace-loading',
    label: 'Whitespace-only label - LOADING (already handled pre-fix)',
    element: makeElement('whitespace-loading', {
      text: ' ',
      text_formatted: [{ insert: ' ' }]
    }),
    loading: true
  },
  {
    key: 'real-label-idle',
    label: 'Real label — idle (control)',
    element: makeElement('real-label-idle', {
      text: 'Submit my application',
      text_formatted: [{ insert: 'Submit my application' }]
    }),
    loading: false
  },
  {
    key: 'real-label-loading',
    label: 'Real label — LOADING (control: width must not move)',
    element: makeElement('real-label-loading', {
      text: 'Submit my application',
      text_formatted: [{ insert: 'Submit my application' }]
    }),
    loading: true
  },
  {
    key: 'no-content-loading',
    label: 'No text, no image — LOADING (loader sizes the button)',
    element: makeElement('no-content-loading', {}),
    loading: true
  }
];

function Case({ spec }: any) {
  return (
    <div className='case'>
      <div className='case-label'>{spec.label}</div>
      {/* .cell is the fit-width grid cell; see button-loader.html for why it
          sizes with max-content rather than shrink-to-fit */}
      <div className='cell' data-case={spec.key}>
        <ButtonElement
          element={spec.element}
          responsiveStyles={
            new ResponsiveStyles(spec.element, ['button'], true, 478)
          }
          editMode={false}
          featheryContext={spec.featheryContext}
          loader={spec.loading ? <FeatherySpinner /> : null}
        />
      </div>
    </div>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <>
    {CASES.map((spec) => (
      <Case key={spec.key} spec={spec} />
    ))}
  </>
);

// Measure after layout has settled. The spinner is an inline SVG, so there is
// no decode to wait on, but the fonts the label is sized by do load async.
(window as any).measure = () => {
  const out: any = {};
  CASES.forEach((spec) => {
    const cell = document.querySelector(
      `[data-case="${spec.key}"]`
    ) as HTMLElement;
    const button = cell.querySelector('button') as HTMLElement;
    const svg = button.querySelector('svg');
    const bRect = button.getBoundingClientRect();
    const sRect = svg?.getBoundingClientRect();
    out[spec.key] = {
      buttonW: +bRect.width.toFixed(1),
      buttonH: +bRect.height.toFixed(1),
      loaderW: sRect ? +sRect.width.toFixed(1) : null,
      loaderH: sRect ? +sRect.height.toFixed(1) : null,
      // Does the loader escape the button? Negative means inside.
      overflow: sRect
        ? +Math.max(
            bRect.left - sRect.left,
            sRect.right - bRect.right,
            bRect.top - sRect.top,
            sRect.bottom - bRect.bottom
          ).toFixed(1)
        : null
    };
  });
  return out;
};
