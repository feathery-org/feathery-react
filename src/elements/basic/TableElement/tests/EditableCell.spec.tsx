import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { EditableCell } from '../EditableCell';

const renderCell = (overrides: Partial<React.ComponentProps<typeof EditableCell>> = {}) => {
  const props = {
    value: 'hello',
    fieldKey: 'field1',
    rowIndex: 0,
    onEdit: jest.fn(),
    ...overrides
  };
  render(<EditableCell {...props} />);
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
    const { onEdit } = renderCell({ value: 'hello', fieldKey: 'field1', rowIndex: 1 });

    fireEvent.click(screen.getByText('hello'));
    const input = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'world' } });
    fireEvent.blur(input);

    expect(onEdit).toHaveBeenCalledWith('field1', 1, 'world');
  });

  it('commits the edit when Enter is pressed', () => {
    const { onEdit } = renderCell({ value: 'hello', fieldKey: 'field1', rowIndex: 1 });

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
    const { onEdit } = renderCell({ value: 'hello', fieldKey: 'field1', rowIndex: 0 });

    fireEvent.click(screen.getByText('hello'));
    const input = screen.getByRole('textbox') as HTMLTextAreaElement;
    // Selection covers the whole value, so a single change replaces it all
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);

    expect(onEdit).toHaveBeenCalledWith('field1', 0, '');
  });

  it('only one cell is in edit mode at a time, committing the previous on switch', () => {
    const onEdit = jest.fn();
    render(
      <div>
        <EditableCell value='A' fieldKey='f' rowIndex={0} onEdit={onEdit} />
        <EditableCell value='B' fieldKey='f' rowIndex={1} onEdit={onEdit} />
      </div>
    );

    // Edit cell A and change its value, but do NOT blur it manually
    fireEvent.click(screen.getByText('A'));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'A2' } });

    // Switching to cell B must close A (one editor) and persist A's edit
    fireEvent.click(screen.getByText('B'));

    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(onEdit).toHaveBeenCalledWith('f', 0, 'A2');
  });
});
