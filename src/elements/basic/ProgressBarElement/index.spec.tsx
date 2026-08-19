import { render } from '@testing-library/react';
import { featheryWindow } from '../../../utils/browser';
import ProgressBarElement from './index';

jest.mock('../../../utils/init', () => ({
  loadCompletedSteps: () => Promise.resolve(),
  getCompletedStepKeys: () => new Set(),
  getFieldValues: () => ({})
}));

const responsiveStyles = {
  addTargets: () => {},
  applyFontStyles: () => {},
  apply: () => {},
  applyCorners: () => {},
  getTarget: () => ({}),
  getMobileBreakpoint: () => 478
};

const element = {
  properties: {
    stepper: true,
    entries: [
      { label: 'Account', step_key: 'account' },
      { label: 'Employment', step_key: 'employment' }
    ]
  },
  styles: { percent_text_layout: 'bottom' },
  mobile_styles: { percent_text_layout: 'none' }
};

const setViewportWidth = (width: number) =>
  Object.defineProperty(featheryWindow(), 'innerWidth', {
    writable: true,
    value: width
  });

describe('ProgressBarElement stepper label placement', () => {
  it('resolves percent_text_layout per viewport', () => {
    setViewportWidth(400);
    const mobile = render(
      <ProgressBarElement
        element={element}
        responsiveStyles={responsiveStyles}
        stepKey='account'
        runElementActions={() => {}}
      />
    );
    expect(mobile.queryByText('Employment')).toBeNull();
    expect(mobile.getByText('2')).toBeTruthy();
    mobile.unmount();

    setViewportWidth(1200);
    const desktop = render(
      <ProgressBarElement
        element={element}
        responsiveStyles={responsiveStyles}
        stepKey='account'
        runElementActions={() => {}}
      />
    );
    expect(desktop.getByText('Employment')).toBeTruthy();
  });
});
