import React from 'react';
import { render } from '@testing-library/react';
import HiddenValueInput from './HiddenValueInput';

const getInput = (container: HTMLElement) =>
  container.querySelector('input') as HTMLInputElement;

describe('HiddenValueInput', () => {
  it('mirrors the value under the field name', () => {
    const { container } = render(<HiddenValueInput name='rating' value={4} />);
    const input = getInput(container);
    expect(input.type).toBe('hidden');
    expect(input.name).toBe('rating');
    expect(input.value).toBe('4');
  });

  it('renders empty rather than "null" or "undefined"', () => {
    const { container: a } = render(<HiddenValueInput name='f' value={null} />);
    expect(getInput(a).value).toBe('');

    const { container: b } = render(
      <HiddenValueInput name='f' value={undefined} />
    );
    expect(getInput(b).value).toBe('');
  });

  it('is barred from constraint validation so it cannot swallow an error', () => {
    // setFormElementError filters type="hidden" out of its element lookup
    const { container } = render(<HiddenValueInput name='f' value='v' />);
    expect(getInput(container).willValidate).toBe(false);
  });
});
