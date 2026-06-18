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
