/**
 * The drag hook. jsdom has no layout and no pointer capture, so both are
 * stubbed; what is worth testing here is the bookkeeping around them - that a
 * grab is always released, that a tap is not mistaken for a drag, and that the
 * grab does not leak into the container's own click actions.
 */
import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { useRowDrag } from '../useRowDrag';
import { DROP_EDGE_ATTR, HANDLE_ATTR, ROW_ATTR } from '../styles';

const ROW_HEIGHT = 20;

// jsdom ships no PointerEvent, so testing-library would fall back to a bare
// Event and silently drop pointerId and the coordinates the hook reads.
class FakePointerEvent extends MouseEvent {
  pointerId: number;
  pointerType: string;

  constructor(type: string, props: any = {}) {
    super(type, props);
    this.pointerId = props.pointerId ?? 0;
    this.pointerType = props.pointerType ?? 'mouse';
  }
}

beforeAll(() => {
  (window as any).PointerEvent = FakePointerEvent;
  (HTMLElement.prototype as any).setPointerCapture = jest.fn();
  (HTMLElement.prototype as any).releasePointerCapture = jest.fn();
  jest
    .spyOn(window, 'getComputedStyle')
    .mockImplementation(() => ({ flexDirection: 'column' } as any));
  jest
    .spyOn(window, 'requestAnimationFrame')
    .mockImplementation((cb: any) => {
      cb(0);
      return 0;
    });
});

beforeEach(() => jest.clearAllMocks());

const Row = ({
  index,
  rowCount,
  onMove,
  onRowClick,
  onTap
}: {
  index: number;
  rowCount: number;
  onMove: (from: number, to: number) => boolean;
  onRowClick?: () => void;
  onTap?: () => void;
}) => {
  const { dragging, handleRef, handleProps } = useRowDrag({
    index,
    rowCount,
    onMove,
    onTap
  });
  return (
    <div {...{ [ROW_ATTR]: index }} onClick={onRowClick}>
      <span
        {...{ [HANDLE_ATTR]: '' }}
        ref={handleRef as any}
        role='button'
        tabIndex={0}
        aria-label={`Row ${index + 1}`}
        aria-pressed={dragging}
        {...handleProps}
      />
      <span {...{ [DROP_EDGE_ATTR]: 'lead' }} data-testid={`lead-${index}`} />
      <span {...{ [DROP_EDGE_ATTR]: 'trail' }} data-testid={`trail-${index}`} />
    </div>
  );
};

const renderTrack = (
  rowCount = 3,
  onRowClick?: () => void,
  onTap?: () => void
) => {
  const onMove = jest.fn().mockReturnValue(true);

  // A real move re-renders the container, and that render is when the
  // destination row claims focus. The stub has to do the same or the focus
  // handoff has nothing to run on.
  const Track = () => {
    const [, bump] = useState(0);
    const handleMove = (from: number, to: number) => {
      const result = onMove(from, to);
      bump((n) => n + 1);
      return result;
    };
    return (
      <div>
        {/* An authored sibling that is not a repeat row - the hook must not
            count it as one. */}
        <button type='button'>Add row</button>
        {Array.from({ length: rowCount }, (_, i) => (
          <Row
            key={i}
            index={i}
            rowCount={rowCount}
            onMove={handleMove}
            onRowClick={onRowClick}
            onTap={onTap}
          />
        ))}
      </div>
    );
  };

  const { container } = render(<Track />);

  // jsdom reports zero-size rects, so lay the rows out by hand.
  container.querySelectorAll(`[${ROW_ATTR}]`).forEach((row) => {
    const i = Number(row.getAttribute(ROW_ATTR));
    (row as HTMLElement).getBoundingClientRect = () =>
      ({
        top: i * ROW_HEIGHT,
        bottom: (i + 1) * ROW_HEIGHT,
        left: 0,
        right: 100
      } as DOMRect);
  });

  return { onMove, container };
};

const grip = (index: number) =>
  screen.getByLabelText(`Row ${index + 1}`) as HTMLElement;

describe('pointer drag', () => {
  it('commits a move once the row has been carried past its neighbours', () => {
    const { onMove } = renderTrack();
    const handle = grip(0);

    fireEvent.pointerDown(handle, {
      bubbles: true, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 0, clientY: 55 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 0, clientY: 55 });

    // Rows span 0-20, 20-40, 40-60. The dragged row's centre starts at 10 and
    // ends at 65, clearing the top edge of both rows below it.
    expect(onMove).toHaveBeenCalledWith(0, 2);
  });

  it('swaps as soon as the row overlaps its neighbour, not the pointer', () => {
    // The grip is at the row's top corner, so the pointer trails the row. A
    // 12px drag puts the row centre at 22, just past row 2's top edge at 20 -
    // under the old pointer-versus-midpoint rule this needed 30px.
    const { onMove } = renderTrack();
    const handle = grip(0);

    fireEvent.pointerDown(handle, {
      bubbles: true, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 0, clientY: 12 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 0, clientY: 12 });

    expect(onMove).toHaveBeenCalledWith(0, 1);
  });

  it('treats movement under the threshold as a tap, not a drag', () => {
    const { onMove } = renderTrack();
    const handle = grip(0);

    fireEvent.pointerDown(handle, {
      bubbles: true, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 0, clientY: 2 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 0, clientY: 2 });

    expect(onMove).not.toHaveBeenCalled();
    expect(handle).toHaveAttribute('aria-pressed', 'false');
  });

  it('does not fire the container click action on grab and release', () => {
    const onRowClick = jest.fn();
    renderTrack(3, onRowClick);
    const handle = grip(0);

    fireEvent.pointerDown(handle, {
      bubbles: true, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.click(handle);

    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('releases the pointer capture on a normal drop', () => {
    renderTrack();
    const handle = grip(0);

    fireEvent.pointerDown(handle, {
      bubbles: true, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 0, clientY: 35 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 0, clientY: 35 });

    expect(handle.releasePointerCapture).toHaveBeenCalledWith(1);
  });

  it('releases the pointer capture when the gesture is cancelled', () => {
    const { onMove } = renderTrack();
    const handle = grip(0);

    fireEvent.pointerDown(handle, {
      bubbles: true, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 0, clientY: 35 });
    fireEvent.pointerCancel(handle, { pointerId: 1 });

    expect(handle.releasePointerCapture).toHaveBeenCalledWith(1);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('releases the pointer capture when the browser takes it away', () => {
    const { onMove } = renderTrack();
    const handle = grip(0);

    fireEvent.pointerDown(handle, {
      bubbles: true, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 0, clientY: 35 });
    fireEvent.lostPointerCapture(handle, { pointerId: 1 });

    expect(handle.releasePointerCapture).toHaveBeenCalledWith(1);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('abandons the move on Escape and leaves the page selectable', () => {
    const { onMove } = renderTrack();
    const handle = grip(0);

    fireEvent.pointerDown(handle, {
      bubbles: true, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 0, clientY: 35 });
    fireEvent.keyDown(handle, { key: 'Escape' });

    expect(onMove).not.toHaveBeenCalled();
    expect(document.body.style.userSelect).toBe('');
  });

  it('ignores a secondary mouse button', () => {
    const { onMove } = renderTrack();
    const handle = grip(0);

    fireEvent.pointerDown(handle, {
      bubbles: true,
      pointerId: 1,
      button: 2,
      pointerType: 'mouse',
      clientX: 0,
      clientY: 0
    });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 0, clientY: 55 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 0, clientY: 55 });

    expect(onMove).not.toHaveBeenCalled();
  });

  it('does nothing when the container has only one row', () => {
    const { onMove } = renderTrack(1);
    const handle = grip(0);

    fireEvent.pointerDown(handle, {
      bubbles: true, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 0, clientY: 55 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 0, clientY: 55 });

    expect(onMove).not.toHaveBeenCalled();
  });
});

describe('tap', () => {
  // Tapping the grip is the single-pointer alternative to dragging that
  // WCAG 2.2 SC 2.5.7 requires, so it has to survive the cases that are not
  // drags - including a container with nothing to drag against.
  it('reports a tap when the press never becomes a drag', () => {
    const onTap = jest.fn();
    renderTrack(3, undefined, onTap);
    const handle = grip(0);

    fireEvent.pointerDown(handle, {
      bubbles: true, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 0, clientY: 0 });

    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it('does not report a tap after a real drag', () => {
    const onTap = jest.fn();
    const { onMove } = renderTrack(3, undefined, onTap);
    const handle = grip(0);

    fireEvent.pointerDown(handle, {
      bubbles: true, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 0, clientY: 55 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 0, clientY: 55 });

    expect(onMove).toHaveBeenCalled();
    expect(onTap).not.toHaveBeenCalled();
  });

  it('still reports a tap on a lone row that cannot be dragged', () => {
    const onTap = jest.fn();
    const { onMove } = renderTrack(1, undefined, onTap);
    const handle = grip(0);

    fireEvent.pointerDown(handle, {
      bubbles: true, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 0, clientY: 55 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 0, clientY: 55 });

    expect(onTap).toHaveBeenCalledTimes(1);
    expect(onMove).not.toHaveBeenCalled();
  });
});

describe('keyboard', () => {
  it('moves down with ArrowDown', () => {
    const { onMove } = renderTrack();
    fireEvent.keyDown(grip(0), { key: 'ArrowDown' });
    expect(onMove).toHaveBeenCalledWith(0, 1);
  });

  it('moves up with ArrowUp', () => {
    const { onMove } = renderTrack();
    fireEvent.keyDown(grip(2), { key: 'ArrowUp' });
    expect(onMove).toHaveBeenCalledWith(2, 1);
  });

  it('accepts the horizontal pair too', () => {
    const { onMove } = renderTrack();
    fireEvent.keyDown(grip(0), { key: 'ArrowRight' });
    expect(onMove).toHaveBeenCalledWith(0, 1);
  });

  it('does nothing at the ends', () => {
    const { onMove } = renderTrack();
    fireEvent.keyDown(grip(0), { key: 'ArrowUp' });
    fireEvent.keyDown(grip(2), { key: 'ArrowDown' });
    expect(onMove).not.toHaveBeenCalled();
  });

  it('moves focus to the row that landed at the destination', () => {
    // The React key for a repeat row is positional, so focus stays on a DOM
    // node that now belongs to a different logical row unless it is moved.
    renderTrack();
    fireEvent.keyDown(grip(0), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(grip(1));
  });
});
