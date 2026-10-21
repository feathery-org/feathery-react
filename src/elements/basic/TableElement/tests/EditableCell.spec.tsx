import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { EditableCell } from '../EditableCell';

// EditableCell is a controlled editor: the parent owns which cell is open. This
// harness mimics that parent so the click-to-edit flow can be exercised in
// isolation, opening this cell when onStartEdit fires and closing on onStopEdit.
const ControlledCell = (
  props: Partial<React.ComponentProps<typeof EditableCell>>
) => {
  const [editing, setEditing] = useState(false);
  return (
    <EditableCell
      value='hello'
      fieldKey='field1'
      rowIndex={0}
      isEditing={editing}
      onEdit={jest.fn()}
      onStartEdit={() => setEditing(true)}
      onStopEdit={() => setEditing(false)}
      onNavigate={jest.fn()}
      {...props}
    />
  );
};

const renderCell = (
  overrides: Partial<React.ComponentProps<typeof EditableCell>> = {}
) => {
  const props = {
    onEdit: jest.fn(),
    onNavigate: jest.fn(),
    ...overrides
  };
  render(<ControlledCell {...props} />);
  return props;
};

describe('EditableCell - click to edit', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('enters edit mode when a populated cell is clicked directly', () => {
    renderCell({ value: 'hello' });

    expect(screen.queryByRole('textbox')).toBeNull();

    fireEvent.click(screen.getByText('hello'));

    const input = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(input).toBeInTheDocument();
    expect(input.value).toBe('hello');
  });

  it('enters edit mode when an empty cell is clicked', () => {
    renderCell({ value: '' });

    fireEvent.click(screen.getByText('Click to edit'));

    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('selects the full cell content on edit so it can be cleared by typing', () => {
    renderCell({ value: 'hello' });

    fireEvent.click(screen.getByText('hello'));

    const input = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe('hello'.length);
  });

  it('has no overflow menu / Clear Field action', () => {
    renderCell({ value: 'hello' });

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('menuitem')).toBeNull();
  });

  it('saves an edited value on blur', () => {
    const { onEdit } = renderCell({
      value: 'hello',
      fieldKey: 'field1',
      rowIndex: 1
    });

    fireEvent.click(screen.getByText('hello'));
    const input = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'world' } });
    fireEvent.blur(input);

    expect(onEdit).toHaveBeenCalledWith('field1', 1, 'world');
  });

  it('commits the edit when Enter is pressed', () => {
    const { onEdit } = renderCell({
      value: 'hello',
      fieldKey: 'field1',
      rowIndex: 1
    });

    fireEvent.click(screen.getByText('hello'));
    const input = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'world' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onEdit).toHaveBeenCalledWith('field1', 1, 'world');
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('does not commit on Shift+Enter (allows newline)', () => {
    const { onEdit } = renderCell({ value: 'hello' });

    fireEvent.click(screen.getByText('hello'));
    const input = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'world' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });

    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('discards changes when Escape is pressed', () => {
    const { onEdit } = renderCell({ value: 'hello' });

    fireEvent.click(screen.getByText('hello'));
    const input = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'world' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    // A blur may follow the unmount; it must not resurrect the discarded change
    fireEvent.blur(input);

    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('clears a cell by selecting all and deleting', () => {
    const { onEdit } = renderCell({
      value: 'hello',
      fieldKey: 'field1',
      rowIndex: 0
    });

    fireEvent.click(screen.getByText('hello'));
    const input = screen.getByRole('textbox') as HTMLTextAreaElement;
    // Selection covers the whole value, so a single change replaces it all
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);

    expect(onEdit).toHaveBeenCalledWith('field1', 0, '');
  });
});

describe('EditableCell - Tab navigation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('commits the current value, then navigates forward on Tab', () => {
    const onEdit = jest.fn();
    const onNavigate = jest.fn();
    renderCell({ value: 'hello', fieldKey: 'f', rowIndex: 2, onEdit, onNavigate });

    fireEvent.click(screen.getByText('hello'));
    const input = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'world' } });
    fireEvent.keyDown(input, { key: 'Tab' });

    expect(onEdit).toHaveBeenCalledWith('f', 2, 'world');
    expect(onNavigate).toHaveBeenCalledWith(false);
  });

  it('navigates backward on Shift+Tab', () => {
    const onNavigate = jest.fn();
    renderCell({ value: 'hello', onNavigate });

    fireEvent.click(screen.getByText('hello'));
    const input = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });

    expect(onNavigate).toHaveBeenCalledWith(true);
  });

  it('prevents the browser default Tab so focus does not drift', () => {
    renderCell({ value: 'hello' });

    fireEvent.click(screen.getByText('hello'));
    const input = screen.getByRole('textbox') as HTMLTextAreaElement;
    const prevented = !fireEvent.keyDown(input, { key: 'Tab' });

    expect(prevented).toBe(true);
  });

  it('does not double-save on the blur that follows Tab navigation', () => {
    const onEdit = jest.fn();
    renderCell({ value: 'hello', fieldKey: 'f', rowIndex: 0, onEdit });

    fireEvent.click(screen.getByText('hello'));
    const input = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'world' } });
    fireEvent.keyDown(input, { key: 'Tab' });
    // Moving focus to the next cell blurs this one; it must not re-fire onEdit
    fireEvent.blur(input);

    expect(onEdit).toHaveBeenCalledTimes(1);
  });
});

describe('EditableCell - typed editors', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('opens a choice column as a list and commits the pick at once', () => {
    const { onEdit } = renderCell({
      value: 'open',
      rule: {
        label: 'Status',
        type: 'text',
        options: ['open', 'closed'],
        optionLabels: ['Open', 'Closed']
      }
    });

    // Shown by label at rest.
    fireEvent.click(screen.getByText('Open'));
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('open');
    expect(
      Array.from(select.options).map((option) => option.textContent)
    ).toEqual(['(empty)', 'Open', 'Closed']);

    fireEvent.change(select, { target: { value: 'closed' } });

    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledWith('field1', 0, 'closed');
    // The pick closed the cell; the blur that follows must not save again.
    fireEvent.blur(select);
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('an arrow key moves the draft without committing; Enter commits it', () => {
    const { onEdit } = renderCell({
      value: 'a',
      rule: { label: 'Status', type: 'text', options: ['a', 'b', 'c'] }
    });
    fireEvent.click(screen.getByText('a'));
    const select = screen.getByRole('combobox') as HTMLSelectElement;

    // A closed native select changes value on each arrow press.
    fireEvent.keyDown(select, { key: 'ArrowDown' });
    fireEvent.change(select, { target: { value: 'b' } });
    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    fireEvent.keyDown(select, { key: 'ArrowDown' });
    fireEvent.change(select, { target: { value: 'c' } });
    expect(onEdit).not.toHaveBeenCalled();

    fireEvent.keyDown(select, { key: 'Enter' });
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledWith('field1', 0, 'c');
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('a mouse pick after arrowing still commits at once', () => {
    const { onEdit } = renderCell({
      value: 'a',
      rule: { label: 'Status', type: 'text', options: ['a', 'b'] }
    });
    fireEvent.click(screen.getByText('a'));
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.keyDown(select, { key: 'ArrowDown' });
    fireEvent.mouseDown(select);
    fireEvent.change(select, { target: { value: 'b' } });
    expect(onEdit).toHaveBeenCalledWith('field1', 0, 'b');
  });

  it('keeps a stored value that is no longer a choice pickable', () => {
    renderCell({
      value: 'legacy',
      rule: { label: 'Status', type: 'text', options: ['open'] }
    });
    fireEvent.click(screen.getByText('legacy'));
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('legacy');
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      '',
      'legacy',
      'open'
    ]);
  });

  it('a boolean column picks true/false and stores a boolean', () => {
    const { onEdit } = renderCell({
      value: false,
      rule: { label: 'Active', type: 'boolean' }
    });
    fireEvent.click(screen.getByText('FALSE'));
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    // A set checkbox cannot be cleared to a value it never holds, and the
    // list reads the way the cell does at rest.
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      'true',
      'false'
    ]);
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      'TRUE',
      'FALSE'
    ]);
    fireEvent.change(select, { target: { value: 'true' } });
    expect(onEdit).toHaveBeenCalledWith('field1', 0, true);
  });

  it('a never-set boolean cell still shows its blank as the current state', () => {
    renderCell({ value: '', rule: { label: 'Active', type: 'boolean' } });
    fireEvent.click(screen.getByText('Click to edit'));
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('');
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      '',
      'true',
      'false'
    ]);
  });

  it('Escape after arrowing through choices discards the draft', () => {
    const { onEdit } = renderCell({
      value: 'a',
      rule: { label: 'Status', type: 'text', options: ['a', 'b'] }
    });
    fireEvent.click(screen.getByText('a'));
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.keyDown(select, { key: 'ArrowDown' });
    fireEvent.change(select, { target: { value: 'b' } });
    fireEvent.keyDown(select, { key: 'Escape' });
    fireEvent.blur(select);
    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('Tab on a choice list commits the keyboard draft and moves on', () => {
    const { onEdit, onNavigate } = renderCell({
      value: 'a',
      rule: { label: 'Status', type: 'text', options: ['a', 'b'] }
    });
    fireEvent.click(screen.getByText('a'));
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.keyDown(select, { key: 'ArrowDown' });
    fireEvent.change(select, { target: { value: 'b' } });
    fireEvent.keyDown(select, { key: 'Tab' });
    expect(onEdit).toHaveBeenCalledWith('field1', 0, 'b');
    expect(onNavigate).toHaveBeenCalledWith(false);
  });

  it('a date column opens the native date picker on the stored day', () => {
    const { onEdit } = renderCell({
      value: '2024-03-05',
      rule: { label: 'Birthday', type: 'date' }
    });
    fireEvent.click(screen.getByText('Mar 5, 2024'));
    const input = screen.getByLabelText('Edit Birthday') as HTMLInputElement;
    expect(input.type).toBe('date');
    expect(input.value).toBe('2024-03-05');

    fireEvent.change(input, { target: { value: '2024-04-06' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onEdit).toHaveBeenCalledWith('field1', 0, '2024-04-06');
  });

  it('Tab inside a date picker moves between its fields, not cells', () => {
    const { onEdit, onNavigate } = renderCell({
      value: '2024-03-05',
      rule: { label: 'Birthday', type: 'date' }
    });
    fireEvent.click(screen.getByText('Mar 5, 2024'));
    const input = screen.getByLabelText('Edit Birthday') as HTMLInputElement;
    // A half-edited picker reports an empty value until every field is set.
    fireEvent.change(input, { target: { value: '' } });
    const tab = fireEvent.keyDown(input, { key: 'Tab' });

    // Not prevented, not navigated, and nothing written for the blank.
    expect(tab).toBe(true);
    expect(onNavigate).not.toHaveBeenCalled();
    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Edit Birthday')).toBeInTheDocument();

    // Leaving the picker with a whole date is what commits.
    fireEvent.change(input, { target: { value: '2024-04-06' } });
    fireEvent.blur(input);
    expect(onEdit).toHaveBeenCalledWith('field1', 0, '2024-04-06');
  });

  it('leaving a date picker blank clears the date, like any blank on blur', () => {
    const { onEdit } = renderCell({
      value: '2024-03-05',
      rule: { label: 'Birthday', type: 'date' }
    });
    fireEvent.click(screen.getByText('Mar 5, 2024'));
    const input = screen.getByLabelText('Edit Birthday') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(onEdit).toHaveBeenCalledWith('field1', 0, null);
  });

  it('a number column refuses letters and stores a number', () => {
    const { onEdit } = renderCell({
      value: 3,
      rule: { label: 'Count', type: 'number' }
    });
    fireEvent.click(screen.getByText('3'));
    const input = screen.getByLabelText('Edit Count') as HTMLInputElement;
    expect(input.getAttribute('inputmode')).toBe('decimal');

    fireEvent.change(input, { target: { value: 'abc' } });
    expect(input.value).toBe('3');
    fireEvent.change(input, { target: { value: '42' } });
    fireEvent.blur(input);
    expect(onEdit).toHaveBeenCalledWith('field1', 0, 42);
  });

  it('a number column drops a half-typed entry instead of storing text', () => {
    const { onEdit } = renderCell({
      value: 3,
      rule: { label: 'Count', type: 'number' }
    });
    fireEvent.click(screen.getByText('3'));
    const input = screen.getByLabelText('Edit Count') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '-' } });
    fireEvent.blur(input);
    expect(onEdit).not.toHaveBeenCalled();
    // Clearing is still a real edit.
    fireEvent.click(screen.getByText('3'));
    const again = screen.getByLabelText('Edit Count') as HTMLInputElement;
    fireEvent.change(again, { target: { value: '' } });
    fireEvent.blur(again);
    expect(onEdit).toHaveBeenCalledWith('field1', 0, null);
  });

  it('an unruled cell still edits as a plain text box storing text', () => {
    const { onEdit } = renderCell({ value: 3 });
    fireEvent.click(screen.getByText('3'));
    const input = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '42' } });
    fireEvent.blur(input);
    expect(onEdit).toHaveBeenCalledWith('field1', 0, '42');
  });
});
