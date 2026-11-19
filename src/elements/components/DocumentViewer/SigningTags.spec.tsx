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
  const initial = screen.getByTitle('Initial: Larkin Hegler');
  expect(initial).toHaveStyle({
    left: '150px',
    top: '300px',
    width: '48px',
    height: '48px',
    // See-through, so the tag doesn't hide the page under it.
    backgroundColor: `${signerColor(1).fill}99`
  });
  // A date is as wide as its label.
  const date = screen.getByTitle('Date Signed: William Hegler');
  expect(date).toHaveStyle({ left: '15px', top: '30px', height: '21px' });
  expect(date.style.width).toBe('');
  expect(date).toHaveTextContent('Date Signed');
});

it('draws a signer\u2019s fields like their sign tags, letting clicks through to editable ones', () => {
  render(
    <SigningTagLayer
      signers={signers}
      scale={1}
      tags={[
        tag({ type: 'text', width: 120, height: 18 }),
        tag({ type: 'checkbox', width: 14, height: 14 }),
        tag({ type: 'radio', width: 14, height: 14 }),
        tag({ type: 'date', width: null, height: 14 })
      ]}
    />
  );
  const text = screen.getByTitle('Text: William Hegler');
  expect(text).toHaveTextContent('Text');
  expect(text).toHaveStyle({
    backgroundColor: `${signerColor(0).fill}99`,
    pointerEvents: 'none'
  });
  expect(screen.getByTitle('Checkbox: William Hegler')).toHaveTextContent('');
  expect(screen.getByTitle('Radio: William Hegler')).toHaveStyle({
    borderRadius: '50%'
  });
  // A deferred date has no widget under it, so it stays hoverable.
  expect(screen.getByTitle('Date: William Hegler')).toHaveStyle({
    pointerEvents: 'auto'
  });
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
  const button = screen.getByRole('button', { name: 'Larkin Hegler 2 fields' });
  fireEvent.click(button);
  expect(onJump).toHaveBeenCalledWith(1);

  rerender(<SignerLegend signers={signers} tags={[]} onJump={onJump} />);
  expect(screen.queryByRole('list')).not.toBeInTheDocument();
});

it('steps through one signer\u2019s tags in reading order and wraps', () => {
  Element.prototype.scrollIntoView = jest.fn();
  const { container } = render(
    <SigningTagLayer
      signers={signers}
      scale={1}
      tags={[
        tag({ signer: 1, type: 'sign_here', y: 500 }),
        tag({ signer: 0 }),
        tag({ signer: 1, x: 300, y: 200 }),
        tag({ signer: 1, type: 'date_signed', x: 50, y: 200, width: null })
      ]}
    />
  );
  // jsdom lays nothing out, so place each tag where its box says.
  container
    .querySelectorAll<HTMLElement>('[data-signing-tag]')
    .forEach((el) => {
      el.getBoundingClientRect = () =>
        ({
          top: parseFloat(getComputedStyle(el).top),
          left: parseFloat(getComputedStyle(el).left)
        } as DOMRect);
    });
  const date = screen.getByTitle('Date Signed: Larkin Hegler');
  const initial = screen.getByTitle('Initial: Larkin Hegler');
  const sign = screen.getByTitle('Sign: Larkin Hegler');
  const jump = (after: HTMLElement | null) =>
    focusNextSignerTag(container, 1, after, false);

  // Top to bottom, then left to right on a line — not payload order.
  expect(jump(null)).toBe(date);
  expect(date).toHaveFocus();
  expect(jump(date)).toBe(initial);
  expect(jump(initial)).toBe(sign);
  expect(jump(sign)).toBe(date);
  // A tag that left the page starts over at the top.
  expect(jump(container.ownerDocument.createElement('div'))).toBe(date);
  expect(focusNextSignerTag(container, 5, null, false)).toBeNull();
});
