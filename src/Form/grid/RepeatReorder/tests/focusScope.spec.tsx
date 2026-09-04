/**
 * A move leaves a focus claim for the destination row to pick up on the render
 * that follows, because the handle that started the move is not the one that
 * should end up focused. A move rerenders the whole form, so every mounted
 * handle re-checks the claim on that render: a claim carrying only an index was
 * consumed by whichever container rendered first, and focus landed in the
 * container that had not moved.
 */
import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { Container } from '../../Container';

const step = {
  id: 'step-1',
  subgrids: [
    { id: 'repeat-a', position: [0], repeated: true },
    { id: 'repeat-b', position: [1], repeated: true }
  ],
  servar_fields: [
    {
      servar: { key: 'alpha', type: 'text_field', repeated: true },
      position: [0, 0]
    },
    {
      servar: { key: 'beta', type: 'text_field', repeated: true },
      position: [1, 0]
    }
  ]
};

const repeatNode = (id: string, position: number[], repeat: number) => ({
  id,
  key: id,
  type: 'container',
  isElement: false,
  position,
  parent: {
    styles: { height: 'fit', axis: 'column' },
    children: [{ id }]
  },
  children: [],
  repeatRoot: true,
  repeat,
  properties: { reorderable: true },
  styles: { axis: 'column', width: 'fill', width_unit: 'fill' }
});

const form = {
  formInstanceId: 'one-form',
  activeStep: step,
  formSettings: { mobileBreakpoint: 480 },
  visiblePositions: { '0': [true, true], '1': [true, true] },
  buttonLoaders: {},
  moveRepeatedRow: jest.fn().mockReturnValue(true),
  insertRepeatedRow: jest.fn().mockReturnValue(true)
};

// Stands in for the form-wide rerender a real move triggers through
// updateFieldValues, on which every mounted handle re-checks the claim.
const Step = () => {
  const [, bump] = useState(0);
  return (
    <>
      <button onClick={() => bump((n) => n + 1)}>rerender</button>
      {[0, 1].map((repeat) => (
        <Container
          key={`a-${repeat}`}
          node={repeatNode('repeat-a', [0], repeat)}
          viewport='desktop'
          form={form}
        />
      ))}
      {[0, 1].map((repeat) => (
        <Container
          key={`b-${repeat}`}
          node={repeatNode('repeat-b', [1], repeat)}
          viewport='desktop'
          form={form}
        />
      ))}
    </>
  );
};

beforeAll(() => {
  (global as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

beforeEach(() => {
  const init = jest.requireActual('../../../../utils/init');
  init.fieldValues.alpha = ['a', 'b'];
  init.fieldValues.beta = ['x', 'y'];
  form.moveRepeatedRow.mockClear();
});

it('keeps the focus claim inside the container that moved', () => {
  const { container } = render(<Step />);

  const grips = Array.from(
    container.querySelectorAll('[data-feathery-reorder-handle]')
  ) as HTMLElement[];
  expect(grips).toHaveLength(4);
  const [, aRow1, bRow0, bRow1] = grips;

  // Container B's first row steps down, so the claim is left for its row 1.
  fireEvent.keyDown(bRow0, { key: 'ArrowDown', bubbles: true });
  expect(form.moveRepeatedRow).toHaveBeenCalled();

  fireEvent.click(screen.getByText('rerender'));

  expect(bRow1).toHaveFocus();
  expect(aRow1).not.toHaveFocus();
});

it('does not leak a claim into another form on the page', () => {
  const other = { ...form, formInstanceId: 'another-form' };
  const { container } = render(
    <>
      <Container
        node={repeatNode('repeat-a', [0], 0)}
        viewport='desktop'
        form={other}
      />
      <Container
        node={repeatNode('repeat-a', [0], 1)}
        viewport='desktop'
        form={other}
      />
      <Step />
    </>
  );

  const grips = Array.from(
    container.querySelectorAll('[data-feathery-reorder-handle]')
  ) as HTMLElement[];
  // The other form's two rows come first, then this form's four.
  const otherRow1 = grips[1];

  fireEvent.keyDown(grips[4], { key: 'ArrowDown', bubbles: true });
  fireEvent.click(screen.getByText('rerender'));

  // Same container id, same row index, different form: not this claim.
  expect(otherRow1).not.toHaveFocus();
});
