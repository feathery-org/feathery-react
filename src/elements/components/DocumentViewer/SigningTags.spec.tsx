import React from 'react';
import { render, screen } from '@testing-library/react';
import {
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
    backgroundColor: signerColor(1).fill
  });
  // A date is as wide as its label.
  const date = screen.getByLabelText('Date Signed: William Hegler');
  expect(date).toHaveStyle({ left: '15px', top: '30px', height: '21px' });
  expect(date.style.width).toBe('');
  expect(date).toHaveTextContent('Date Signed');
});

it('lists only the signers who have a tag', () => {
  const { rerender } = render(
    <SignerLegend signers={signers} tags={[tag({ signer: 1 })]} />
  );
  expect(screen.getByRole('list', { name: 'Signers' })).toHaveTextContent(
    'Larkin Hegler'
  );
  expect(screen.queryByText('William Hegler')).not.toBeInTheDocument();

  rerender(<SignerLegend signers={signers} tags={[]} />);
  expect(screen.queryByRole('list')).not.toBeInTheDocument();
});
