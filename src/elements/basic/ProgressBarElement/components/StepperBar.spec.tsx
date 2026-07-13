import { fireEvent, render } from '@testing-library/react';
import StepperBar from './StepperBar';

jest.mock('../../../../utils/init', () => ({
  getCompletedStepKeys: () => new Set(),
  getFieldValues: () => ({})
}));

describe('StepperBar', () => {
  it('only navigates to non-active steps allowed by reachability', () => {
    const onStepClick = jest.fn();
    const styles = {
      getTarget: (target: string) =>
        target === 'bar' ? { backgroundColor: '#1677ff' } : {}
    };
    const stepConfigs = [
      { label: 'Health and lifestyle', step_key: 'health' },
      { label: 'Coverage preferences', step_key: 'coverage' },
      { label: 'Review and submit', step_key: 'review' }
    ];
    const { getByText, rerender } = render(
      <StepperBar
        styles={styles}
        stepConfigs={stepConfigs}
        stepKey='coverage'
        onStepClick={onStepClick}
      />
    );

    fireEvent.click(getByText('3'));
    expect(onStepClick).not.toHaveBeenCalled();

    rerender(
      <StepperBar
        styles={styles}
        stepConfigs={stepConfigs}
        stepKey='coverage'
        onStepClick={onStepClick}
        allowAllNavigation
      />
    );

    fireEvent.click(getByText('3'));
    fireEvent.click(getByText('2'));
    expect(onStepClick).toHaveBeenCalledTimes(1);
    expect(onStepClick).toHaveBeenCalledWith(
      expect.objectContaining({ step_key: 'review' })
    );
  });
});
