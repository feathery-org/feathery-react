import { render } from '@testing-library/react';
import ResponsiveStyles from '../../styles';

jest.mock('../../components/TextNodes', () => () => null);

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

const renderButton = async (
  styles: Record<string, any>,
  mobileStyles: Record<string, any> = {}
) => {
  const ButtonElement = (await import('../ButtonElement')).default;
  const element = {
    id: 'button-1',
    properties: { text: 'Submit', image: 'https://x.test/img.png' },
    styles: {
      background_color: '2954AFFF',
      border_top_color: '2954AFFF',
      border_right_color: '2954AFFF',
      border_bottom_color: '2954AFFF',
      border_left_color: '2954AFFF',
      ...styles
    },
    mobile_styles: mobileStyles
  };
  const responsiveStyles = new ResponsiveStyles(element, [], true);
  render(
    <ButtonElement element={element} responsiveStyles={responsiveStyles} />
  );
  return responsiveStyles;
};

const MOBILE_KEY = '@media (max-width: 478px)';

describe('ButtonElement', () => {
  it('maps the center flex direction to an image-only row layout', async () => {
    const responsiveStyles = await renderButton({ flex_direction: 'center' });
    expect(responsiveStyles.getTarget('button').flexDirection).toBe('row');
    expect(responsiveStyles.getTarget('buttonLabel').display).toBe('none');
  });

  it('passes standard flex directions through and keeps the label visible', async () => {
    const responsiveStyles = await renderButton({ flex_direction: 'column' });
    expect(responsiveStyles.getTarget('button').flexDirection).toBe('column');
    expect(responsiveStyles.getTarget('buttonLabel').display).toBe(
      'inline-block'
    );
  });

  it('restores the label when a mobile override reverts center to row', async () => {
    const responsiveStyles = await renderButton(
      { flex_direction: 'center' },
      { flex_direction: 'row' }
    );
    const label = responsiveStyles.getTarget('buttonLabel');
    expect(label.display).toBe('none');
    expect(label[MOBILE_KEY].display).toBe('inline-block');
  });
});
