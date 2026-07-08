import React, { useRef } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useFieldProgress } from './useFieldProgress';

function Harness({ fieldLayer }: { fieldLayer: any }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const { requiredRemaining, jumpToNextField } = useFieldProgress(
    fieldLayer,
    ref,
    'k',
    0
  );
  return (
    <div ref={ref} data-testid='canvas'>
      <span data-testid='count'>{String(requiredRemaining)}</span>
      <input data-testid='field' name='1own.H.1own_H_Addr123' />
      <button data-testid='jump' onClick={jumpToNextField}>
        Jump
      </button>
    </div>
  );
}

it('counts required fields initially and recounts after input (debounced)', async () => {
  jest.useFakeTimers();
  const fieldLayer = {
    validate: jest
      .fn()
      .mockResolvedValue([{ docIndex: 0, fieldName: '1own.H.Addr123' }]),
    getOverrides: jest.fn(),
    reset: jest.fn()
  };
  render(<Harness fieldLayer={fieldLayer} />);
  expect(screen.getByTestId('count')).toHaveTextContent('null');
  await act(async () => {
    jest.advanceTimersByTime(500);
  });
  expect(screen.getByTestId('count')).toHaveTextContent('1');

  fieldLayer.validate.mockResolvedValue([]);
  fireEvent.input(screen.getByTestId('canvas'));
  await act(async () => {
    jest.advanceTimersByTime(500);
  });
  expect(screen.getByTestId('count')).toHaveTextContent('0');
  jest.useRealTimers();
});

it('jumps to the first remaining required field, and is a no-op before issues populate', async () => {
  jest.useFakeTimers();
  const scrollIntoView = jest.fn();
  const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollIntoView = scrollIntoView;
  try {
    const fieldLayer = {
      validate: jest
        .fn()
        .mockResolvedValue([{ docIndex: 0, fieldName: '1own.H.Addr123' }]),
      getOverrides: jest.fn(),
      reset: jest.fn()
    };
    render(<Harness fieldLayer={fieldLayer} />);

    // Before the first count resolves, jump is a no-op.
    expect(screen.getByTestId('count')).toHaveTextContent('null');
    fireEvent.click(screen.getByTestId('jump'));
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(screen.getByTestId('field'));

    await act(async () => {
      jest.advanceTimersByTime(500);
    });
    expect(screen.getByTestId('count')).toHaveTextContent('1');

    fireEvent.click(screen.getByTestId('jump'));
    const field = screen.getByTestId('field');
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.instances[0]).toBe(field);
    expect(document.activeElement).toBe(field);
  } finally {
    HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    jest.useRealTimers();
  }
});
