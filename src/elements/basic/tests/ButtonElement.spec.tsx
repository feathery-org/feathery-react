import { render } from '@testing-library/react';
import ResponsiveStyles from '../../styles';

jest.mock('../../components/TextNodes', () => () => null);
jest.mock('../../components/useBorder', () => () => ({
  borderStyles: { active: {}, hover: {}, disabled: {} },
  customBorder: null
}));

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: jest.fn().mockImplementation((query) => ({
      matches: query === '(hover: hover)',
      media: query,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      addListener: jest.fn(),
      removeListener: jest.fn()
    }))
  });
});

const rulesFor = (element: Element | null) => {
  const className = Array.from(element?.classList ?? []).find((name) =>
    name.startsWith('css-')
  );
  if (!className) return [];
  return Array.from(document.head.querySelectorAll('style'))
    .flatMap((style) =>
      Array.from((style as HTMLStyleElement).sheet?.cssRules ?? [])
    )
    .filter(
      (rule): rule is CSSStyleRule =>
        'selectorText' in rule &&
        (rule as CSSStyleRule).selectorText.includes(`.${className}`)
    );
};

describe('ButtonElement', () => {
  it('applies image state colors to stored icons and legacy images', async () => {
    const ButtonElement = (await import('../ButtonElement')).default;
    const element = {
      id: 'button-icon-states',
      properties: {
        actions: [{}],
        icon_source: 'IconHeart',
        icon_glyph: {
          variant: 'outline',
          nodes: [['path', { d: 'M12 5l0 14' }]]
        },
        text: '',
        text_formatted: []
      },
      styles: {
        background_color: 'FFFFFF',
        flex_direction: 'row',
        hover_image_color: 'black',
        selected_image_color: 'black',
        disabled_image_color: 'black'
      },
      mobile_styles: {}
    };
    const responsiveStyles = new ResponsiveStyles(element, [], true);

    const { container } = render(
      <ButtonElement element={element} responsiveStyles={responsiveStyles} />
    );
    const button = container.querySelector('button');
    const rules = rulesFor(button).filter((rule) =>
      rule.cssText.includes('brightness(0%)')
    );
    const hasRule = (state: string, target: string) =>
      rules.some(
        (rule) =>
          rule.selectorText.includes(state) &&
          rule.selectorText.includes(target)
      );

    expect(
      container.querySelector('[data-feathery-button-icon="IconHeart"]')
    ).not.toBeNull();
    expect(hasRule(':hover', 'img')).toBe(true);
    expect(hasRule(':hover', '[data-feathery-button-icon]')).toBe(true);
    expect(hasRule('.active', 'img')).toBe(true);
    expect(hasRule('.active', '[data-feathery-button-icon]')).toBe(true);
    expect(hasRule('[aria-disabled="true"]', 'img')).toBe(true);
    expect(
      hasRule('[aria-disabled="true"]', '[data-feathery-button-icon]')
    ).toBe(true);
  });
});
