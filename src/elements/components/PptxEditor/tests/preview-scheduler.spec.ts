import { schedulePreview } from '../loading/previewScheduler';

it('prioritizes visible previews and cancels queued speculative work', () => {
  jest.useFakeTimers();
  try {
    const order: string[] = [];
    schedulePreview(() => order.push('background'), true);
    const cancel = schedulePreview(() => order.push('cancelled'), true);
    schedulePreview(() => order.push('visible'));
    cancel();
    jest.runOnlyPendingTimers();
    expect(order).toEqual(['visible']);
    jest.runAllTimers();
    expect(order).toEqual(['visible', 'background']);
  } finally {
    jest.useRealTimers();
  }
});
