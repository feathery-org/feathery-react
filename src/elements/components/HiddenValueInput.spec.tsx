import React from 'react';
import { render } from '@testing-library/react';
import HiddenValueInput from './HiddenValueInput';
import { featheryDoc } from '../../utils/browser';

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

  it('announces each value change with input and change events', () => {
    const { container, rerender } = render(
      <HiddenValueInput name='rating' value={2} />
    );
    const seen: string[] = [];
    const record = (e: Event) =>
      seen.push(`${e.type}:${(e.target as HTMLInputElement).value}`);
    featheryDoc().addEventListener('input', record, true);
    featheryDoc().addEventListener('change', record, true);

    rerender(<HiddenValueInput name='rating' value={2} />);
    expect(seen).toEqual([]);

    rerender(<HiddenValueInput name='rating' value={5} />);
    expect(seen).toEqual(['input:5', 'change:5']);
    expect(getInput(container).value).toBe('5');

    featheryDoc().removeEventListener('input', record, true);
    featheryDoc().removeEventListener('change', record, true);
  });

  it('fires nothing on mount so a prefilled value is not a user edit', () => {
    const seen: string[] = [];
    const record = (e: Event) => seen.push(e.type);
    featheryDoc().addEventListener('change', record, true);
    render(<HiddenValueInput name='f' value='prefilled' />);
    expect(seen).toEqual([]);
    featheryDoc().removeEventListener('change', record, true);
  });
});
