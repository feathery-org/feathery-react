import React, { useRef } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useFieldProgress } from './useFieldProgress';

function Harness({ fieldLayer }: { fieldLayer: any }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const { requiredRemaining } = useFieldProgress(fieldLayer, ref, 'k', 0);
  return (
    <div ref={ref} data-testid='canvas'>
      <span data-testid='count'>{String(requiredRemaining)}</span>
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
