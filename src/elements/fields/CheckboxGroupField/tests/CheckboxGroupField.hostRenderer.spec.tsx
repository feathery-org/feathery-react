import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import CheckboxGroupField from '../index';
import type { CheckboxRenderer } from '../index';
import {
  createCheckboxGroupElement,
  createCheckboxGroupProps
} from './test-utils';

const renderCheckbox: CheckboxRenderer = ({ label, inputRef, ...props }) => (
  <label>
    <input {...props} ref={inputRef} />
    {label}
  </label>
);

it('preserves native selections and maximum-choice restrictions with a host renderer', () => {
  const element = createCheckboxGroupElement('checkbox_group');
  element.servar.max_length = 1;
  const onChange = jest.fn((event: React.ChangeEvent<HTMLInputElement>) => ({
    name: event.target.name,
    checked: event.target.checked
  }));
  const props = createCheckboxGroupProps(element, {
    renderCheckbox,
    fieldVal: ['Option 1'],
    onChange
  });
  render(<CheckboxGroupField {...props} />);
  const inputs = screen.getAllByRole('checkbox') as HTMLInputElement[];
  expect(inputs[0].checked).toBe(true);
  expect(inputs[1].disabled).toBe(true);
  fireEvent.click(inputs[0]);
  expect(onChange.mock.results[0].value).toEqual({
    name: 'Option 1',
    checked: false
  });
});

it('retains partial select-all state and the other choice with a host renderer', () => {
  const element = createCheckboxGroupElement('checkbox_group', {
    select_all: true,
    other: true
  });
  const onSelectAllChange = jest.fn();
  const props = createCheckboxGroupProps(element, {
    renderCheckbox,
    fieldVal: ['Option 1'],
    otherVal: 'Custom choice',
    onSelectAllChange
  });
  render(<CheckboxGroupField {...props} />);
  const selectAll = screen.getByRole('checkbox', {
    name: 'Select All'
  }) as HTMLInputElement;
  expect(selectAll.indeterminate).toBe(true);
  fireEvent.click(selectAll);
  expect(onSelectAllChange).toHaveBeenCalledWith(
    ['Option 1', 'Option 2', 'Option 3'],
    true
  );
  expect(screen.getByRole('checkbox', { name: 'Other' })).toBeTruthy();
});
