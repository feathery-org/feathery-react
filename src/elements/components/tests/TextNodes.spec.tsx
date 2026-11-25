import { render } from '@testing-library/react';
import ResponsiveStyles from '../../styles';
import TextNodes from '../TextNodes';

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: jest.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      addListener: jest.fn(),
      removeListener: jest.fn()
    }))
  });
});

const makeElement = (textFormatted: any[]) => ({
  id: 'text-1',
  properties: {
    text: 'placeholder',
    text_formatted: textFormatted,
    actions: []
  },
  styles: {},
  mobile_styles: {}
});

const renderNodes = (textFormatted: any[], editMode?: any, focused = false) => {
  const element = makeElement(textFormatted);
  const responsiveStyles = new ResponsiveStyles(element, ['text'], true);
  return render(
    <TextNodes
      element={element}
      responsiveStyles={responsiveStyles}
      editMode={editMode}
      focused={focused}
    />
  );
};

describe('TextNodes', () => {
  it('does not leak the final run styles onto earlier runs while editing', () => {
    const { container } = renderNodes(
      [
        { insert: 'Plain' },
        {
          insert: 'Styled',
          attributes: {
            font_color: 'FF0000FF',
            font_size: 27,
            font_weight: 700
          }
        }
      ],
      'editable',
      true
    );
    const runs = container.querySelectorAll('span[data-index]');

    expect(getComputedStyle(runs[0]).color).not.toBe('rgba(255, 0, 0, 1)');
    expect(getComputedStyle(runs[0]).fontSize).not.toBe('27px');
    expect(getComputedStyle(runs[1]).color).toBe('rgba(255, 0, 0, 1)');
    expect(getComputedStyle(runs[1]).fontSize).toBe('27px');
  });

  it('collapses an empty editable label until it is selected', () => {
    const element = {
      ...makeElement([]),
      properties: { text: '', text_formatted: [], actions: [] }
    };
    const responsiveStyles = new ResponsiveStyles(element, ['text'], true);
    const props = { element, responsiveStyles, editMode: 'editable' };
    const { container, rerender } = render(<TextNodes {...props} />);
    const label = container.querySelector('#span-text-1')!;
    expect(getComputedStyle(label).minWidth).toBe('0');

    rerender(<TextNodes {...props} focused />);

    expect(getComputedStyle(label).minWidth).toBe('5px');
  });
});
