import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  focusNextSignerTag,
  SignerLegend,
  SigningTag,
  SigningTagLayer,
  signerColor
} from './SigningTags';

const signers = [{ name: 'William Hegler' }, { name: 'Larkin Hegler' }];
const tag = (overrides: Partial<SigningTag>): SigningTag => ({
  type: 'initial_here',
  signer: 0,
  page: 0,
  x: 100,
  y: 200,
  width: 32,
  height: 32,
  ...overrides
});

it('draws each tag at its scaled box in its signer color', () => {
  render(
    <SigningTagLayer
      signers={signers}
      scale={1.5}
      tags={[
        tag({ signer: 1 }),
        tag({ type: 'date_signed', x: 10, y: 20, width: null, height: 14 })
      ]}
    />
  );
  const initial = screen.getByLabelText('Initial: Larkin Hegler');
  expect(initial).toHaveStyle({
    left: '150px',
    top: '300px',
    width: '48px',
    height: '48px',
    // See-through, so the tag doesn't hide the page under it.
    backgroundColor: `${signerColor(1).fill}99`
  });
  // A date is as wide as its label.
  const date = screen.getByLabelText('Date Signed: William Hegler');
  expect(date).toHaveStyle({ left: '15px', top: '30px', height: '21px' });
  expect(date.style.width).toBe('');
  expect(date).toHaveTextContent('Date Signed');
});

it('lists only the signers who have a tag, each stepping through their own', () => {
  const onJump = jest.fn();
  const { rerender } = render(
    <SignerLegend
      signers={signers}
      tags={[tag({ signer: 1 }), tag({ signer: 1 })]}
      onJump={onJump}
    />
  );
  expect(screen.queryByText('William Hegler')).not.toBeInTheDocument();
  const button = screen.getByRole('button', { name: /Larkin Hegler/ });
  expect(button).toHaveTextContent('2');
  fireEvent.click(button);
  expect(onJump).toHaveBeenCalledWith(1);

  rerender(<SignerLegend signers={signers} tags={[]} onJump={onJump} />);
  expect(screen.queryByRole('list')).not.toBeInTheDocument();
});

it('steps through one signer\u2019s tags and wraps', () => {
  Element.prototype.scrollIntoView = jest.fn();
  const { container } = render(
    <SigningTagLayer
      signers={signers}
      scale={1}
      tags={[
        tag({ signer: 1 }),
        tag({ signer: 0 }),
        tag({ signer: 1, type: 'sign_here' })
      ]}
    />
  );
  const jump = (after: number) =>
    focusNextSignerTag(container, 1, after, false);

  expect(jump(-1)).toBe(0);
  expect(screen.getByLabelText('Initial: Larkin Hegler')).toHaveFocus();
  expect(jump(0)).toBe(1);
  expect(screen.getByLabelText('Sign: Larkin Hegler')).toHaveFocus();
  expect(jump(1)).toBe(0);
  expect(focusNextSignerTag(container, 5, -1, false)).toBe(-1);
});
