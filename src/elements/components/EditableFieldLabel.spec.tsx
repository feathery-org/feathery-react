import { fireEvent, render, screen } from '@testing-library/react';
import EditableFieldLabel from './EditableFieldLabel';

const setup = (label = 'Address (legal or civic)', focused = false) => {
  const setLabel = jest.fn();
  const { rerender } = render(
    <EditableFieldLabel
      elementId='el-1'
      label={label}
      focused={focused}
      setLabel={setLabel}
    />
  );
  const span = screen.getByText(label);
  const setFocused = (nextFocused: boolean) =>
    rerender(
      <EditableFieldLabel
        elementId='el-1'
        label={label}
        focused={nextFocused}
        setLabel={setLabel}
      />
    );
  return { span, setLabel, setFocused };
};

describe('EditableFieldLabel', () => {
  it('renders an editable span with the control layer lookup id', () => {
    const { span } = setup();
    expect(span).toHaveAttribute('contenteditable', 'true');
    expect(span).toHaveAttribute('id', 'span-el-1');
  });

  it('prevents caret placement until the element is selected', () => {
    const { span } = setup();
    const unfocusedMouseDown = fireEvent.mouseDown(span);
    // preventDefault called → fireEvent returns false
    expect(unfocusedMouseDown).toBe(false);
  });

  it('allows caret placement and enters editing on click once selected', () => {
    const { span, setLabel } = setup('Address (legal or civic)', true);
    const focusedMouseDown = fireEvent.mouseDown(span);
    expect(focusedMouseDown).toBe(true);

    fireEvent.click(span);
    span.textContent = 'Renamed by click';
    fireEvent.blur(span);

    expect(setLabel).toHaveBeenCalledWith('Renamed by click');
  });

  it('ends editing when the element is deselected', () => {
    const { span, setLabel, setFocused } = setup(
      'Address (legal or civic)',
      true
    );
    fireEvent.click(span);
    setFocused(false);

    span.textContent = 'Should not commit';
    fireEvent.blur(span);
    expect(setLabel).not.toHaveBeenCalled();
  });

  it('commits the new label on blur after focus', () => {
    const { span, setLabel } = setup();
    fireEvent.focus(span);
    span.textContent = 'New Label';
    fireEvent.blur(span);

    expect(setLabel).toHaveBeenCalledWith('New Label');
  });

  it('does not commit a blur without prior focus', () => {
    const { span, setLabel } = setup();
    span.textContent = 'Sneaky';
    fireEvent.blur(span);

    expect(setLabel).not.toHaveBeenCalled();
  });

  it('commits on Enter', () => {
    const { span, setLabel } = setup();
    fireEvent.focus(span);
    span.textContent = 'Enter Label';
    fireEvent.keyDown(span, { key: 'Enter' });
    fireEvent.blur(span);

    expect(setLabel).toHaveBeenCalledWith('Enter Label');
  });

  it('does not commit on Shift+Enter (inserts a newline instead)', () => {
    const { span, setLabel } = setup();
    fireEvent.focus(span);
    span.textContent = 'Line one';
    fireEvent.keyDown(span, { key: 'Enter', shiftKey: true });

    // Still editing — no commit happened
    expect(setLabel).not.toHaveBeenCalled();

    fireEvent.blur(span);
    expect(setLabel).toHaveBeenCalledWith('Line one');
  });

  it('reverts on Escape without committing', () => {
    const { span, setLabel } = setup();
    fireEvent.focus(span);
    span.textContent = 'Discarded';
    fireEvent.keyDown(span, { key: 'Escape' });
    fireEvent.blur(span);

    expect(setLabel).not.toHaveBeenCalled();
    expect(span.textContent).toBe('Address (legal or civic)');
  });

  it('reverts an empty or unchanged label instead of committing', () => {
    const { span, setLabel } = setup();
    fireEvent.focus(span);
    span.textContent = '   ';
    fireEvent.blur(span);

    expect(setLabel).not.toHaveBeenCalled();
    expect(span.textContent).toBe('Address (legal or civic)');

    fireEvent.focus(span);
    span.textContent = 'Address (legal or civic)';
    fireEvent.blur(span);
    expect(setLabel).not.toHaveBeenCalled();
  });

  it('trims whitespace from the committed label', () => {
    const { span, setLabel } = setup();
    fireEvent.focus(span);
    span.textContent = '  Trimmed  ';
    fireEvent.blur(span);

    expect(setLabel).toHaveBeenCalledWith('Trimmed');
  });
});
