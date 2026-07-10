import React, { useRef } from 'react';
import { render, screen, act } from '@testing-library/react';
import { useActivePage, pageKey } from './useActivePage';

let ioCallback: (entries: any[]) => void;
class MockIntersectionObserver {
  constructor(cb: (entries: any[]) => void) {
    ioCallback = cb;
  }

  observe = jest.fn();

  unobserve = jest.fn();

  disconnect = jest.fn();
}

beforeAll(() => {
  (global as any).IntersectionObserver = MockIntersectionObserver;
});

function Harness({ order }: { order: string[] }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const { activePageNumber, observePage } = useActivePage(rootRef, order);
  return (
    <div ref={rootRef}>
      {order.map((key) => (
        <div key={key} data-testid={key} ref={(el) => observePage(key, el)} />
      ))}
      <span data-testid='active'>{activePageNumber}</span>
    </div>
  );
}

it('builds canonical page keys', () => {
  expect(pageKey('http://x/a.pdf', 3)).toBe('http://x/a.pdf-3');
});

it('reports the most-visible page as active', () => {
  render(<Harness order={['u-0', 'u-1']} />);
  expect(screen.getByTestId('active')).toHaveTextContent('1');
  act(() => {
    ioCallback([
      { target: screen.getByTestId('u-0'), intersectionRatio: 0.2 },
      { target: screen.getByTestId('u-1'), intersectionRatio: 0.9 }
    ]);
  });
  expect(screen.getByTestId('active')).toHaveTextContent('2');
});
