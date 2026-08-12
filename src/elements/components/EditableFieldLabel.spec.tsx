import { fireEvent, render, screen } from '@testing-library/react';
import EditableFieldLabel from './EditableFieldLabel';

const setup = (label = 'Address (legal or civic)') => {
  const setLabel = jest.fn();
  render(
    <EditableFieldLabel elementId='el-1' label={label} setLabel={setLabel} />
  );
  const span = screen.getByText(label);
  return { span, setLabel };
};

describe('EditableFieldLabel', () => {
  it('renders an editable span with the control layer lookup id', () => {
    const { span } = setup();
    expect(span).toHaveAttribute('contenteditable', 'true');
    expect(span).toHaveAttribute('id', 'span-el-1');
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
