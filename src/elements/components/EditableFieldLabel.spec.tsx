import { fireEvent, render } from '@testing-library/react';
import EditableFieldLabel from './EditableFieldLabel';
import { LabelRun } from '../utils/fieldLabelRuns';
import { featheryDoc } from '../../utils/browser';

const responsiveStyles = {
  getRichFontStyles: (attrs: any) =>
    attrs.font_weight ? { fontWeight: attrs.font_weight } : {}
};

const labelSpan = () =>
  featheryDoc().getElementById('span-el-1') as HTMLElement;

const setup = (
  label = 'Address (legal or civic)',
  focused = false,
  runs: LabelRun[] | null = null
) => {
  const setLabel = jest.fn();
  const renderLabel = (nextFocused: boolean) => (
    <EditableFieldLabel
      elementId='el-1'
      label={label}
      runs={runs}
      responsiveStyles={responsiveStyles}
      focused={nextFocused}
      setLabel={setLabel}
    />
  );
  const { rerender } = render(renderLabel(focused));
  const setFocused = (nextFocused: boolean) =>
    rerender(renderLabel(nextFocused));
  return { span: labelSpan(), setLabel, setFocused };
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

    expect(setLabel).toHaveBeenCalledWith('Renamed by click', null);
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

    expect(setLabel).toHaveBeenCalledWith('New Label', null);
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

    expect(setLabel).toHaveBeenCalledWith('Enter Label', null);
  });

  it('does not commit on Shift+Enter (inserts a newline instead)', () => {
    const { span, setLabel } = setup();
    fireEvent.focus(span);
    span.textContent = 'Line one';
    fireEvent.keyDown(span, { key: 'Enter', shiftKey: true });

    // Still editing — no commit happened
    expect(setLabel).not.toHaveBeenCalled();

    fireEvent.blur(span);
    expect(setLabel).toHaveBeenCalledWith('Line one', null);
  });

  it('reverts on Escape without committing', () => {
    const { span, setLabel } = setup();
    fireEvent.focus(span);
    span.textContent = 'Discarded';
    fireEvent.keyDown(span, { key: 'Escape' });
    fireEvent.blur(span);

    expect(setLabel).not.toHaveBeenCalled();
    expect(labelSpan().textContent).toBe('Address (legal or civic)');
  });

  it('reverts an empty or unchanged label instead of committing', () => {
    const { span, setLabel } = setup();
    fireEvent.focus(span);
    span.textContent = '   ';
    fireEvent.blur(span);

    expect(setLabel).not.toHaveBeenCalled();
    const reverted = labelSpan();
    expect(reverted.textContent).toBe('Address (legal or civic)');

    fireEvent.focus(reverted);
    reverted.textContent = 'Address (legal or civic)';
    fireEvent.blur(reverted);
    expect(setLabel).not.toHaveBeenCalled();
  });

  it('trims whitespace from the committed label', () => {
    const { span, setLabel } = setup();
    fireEvent.focus(span);
    span.textContent = '  Trimmed  ';
    fireEvent.blur(span);

    expect(setLabel).toHaveBeenCalledWith('Trimmed', null);
  });

  it('renders formatted runs and keeps their formatting through an edit', () => {
    const runs = [
      { insert: 'Full ' },
      { insert: 'legal', attributes: { font_weight: 700 } },
      { insert: ' name' }
    ];
    const { span, setLabel } = setup('Full legal name', true, runs);
    const bold = span.querySelector('[data-index="1"]') as HTMLElement;
    expect(bold.textContent).toBe('legal');
    expect(getComputedStyle(bold).fontWeight).toBe('700');

    fireEvent.focus(span);
    bold.textContent = 'legal given';
    fireEvent.blur(span);

    expect(setLabel).toHaveBeenCalledWith('Full legal given name', [
      { insert: 'Full ' },
      { insert: 'legal given', attributes: { font_weight: 700 } },
      { insert: ' name' }
    ]);
  });
});
