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
  mobileStyles: Record<string, any> = {},
  properties: Record<string, any> = {}
) => {
  const ButtonElement = (await import('../ButtonElement')).default;
  const element = {
    id: 'button-1',
    properties: {
      text: 'Submit',
      image: 'https://x.test/img.png',
      ...properties
    },
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
  const { container } = render(
    <ButtonElement element={element} responsiveStyles={responsiveStyles} />
  );
  return { responsiveStyles, button: container.querySelector('button')! };
};

const MOBILE_KEY = '@media (max-width: 478px)';

describe('ButtonElement', () => {
  it('maps the center flex direction to an image-only row layout', async () => {
    const { responsiveStyles, button } = await renderButton({
      flex_direction: 'center'
    });
    expect(responsiveStyles.getTarget('button').flexDirection).toBe('row');
    expect(responsiveStyles.getTarget('buttonLabel').display).toBe('none');
    // The hidden label would otherwise leave the button with no accessible name
    expect(button.getAttribute('aria-label')).toBe('Submit');
  });

  it('passes standard flex directions through and keeps the label visible', async () => {
    const { responsiveStyles, button } = await renderButton({
      flex_direction: 'column'
    });
    expect(responsiveStyles.getTarget('button').flexDirection).toBe('column');
    expect(responsiveStyles.getTarget('buttonLabel').display).toBe(
      'inline-block'
    );
    expect(button.getAttribute('aria-label')).toBeNull();
  });

  it('keeps the label visible when center is set without an image', async () => {
    const { responsiveStyles, button } = await renderButton(
      { flex_direction: 'center' },
      {},
      { image: '' }
    );
    expect(responsiveStyles.getTarget('buttonLabel').display).toBe(
      'inline-block'
    );
    expect(button.getAttribute('aria-label')).toBeNull();
  });

  it('prefers an explicit aria label over the button text', async () => {
    const { button } = await renderButton(
      { flex_direction: 'center' },
      {},
      { aria_label: 'Continue' }
    );
    expect(button.getAttribute('aria-label')).toBe('Continue');
  });

  it('restores the label when a mobile override reverts center to row', async () => {
    const { responsiveStyles } = await renderButton(
      { flex_direction: 'center' },
      { flex_direction: 'row' }
    );
    const label = responsiveStyles.getTarget('buttonLabel');
    expect(label.display).toBe('none');
    expect(label[MOBILE_KEY].display).toBe('inline-block');
  });
});
