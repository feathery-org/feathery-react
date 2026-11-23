import { render } from '@testing-library/react';
import ProgressBarElement from '.';

const responsiveStyles = {
  addTargets: jest.fn(),
  applyFontStyles: jest.fn(),
  apply: jest.fn(),
  applyCorners: jest.fn(),
  getTarget: jest.fn().mockReturnValue({})
};

describe('ProgressBarElement DOM naming', () => {
  it('is named progress_bar since it has no content to derive one from', () => {
    const { container } = render(
      <ProgressBarElement
        element={{ properties: {}, styles: {} }}
        responsiveStyles={responsiveStyles}
        progress={40}
      />
    );
    expect(container.firstElementChild?.getAttribute('name')).toBe(
      'progress_bar'
    );
  });
});
