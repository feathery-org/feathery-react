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

// jsdom's getComputedStyle can't resolve class-based styles for these
// properties, and emotion inserts rules via CSSOM (empty textContent), so
// assert on the element's own base rule from the stylesheets. Style rules
// accumulate across tests, so scope to the element's class.
const ruleFor = (el: Element | null) => {
  const cls = Array.from(el?.classList ?? []).find((c) => c.startsWith('css-'));
  if (!cls) return '';
  const rules = Array.from(document.head.querySelectorAll('style')).flatMap(
    (s) => Array.from((s as HTMLStyleElement).sheet?.cssRules ?? [])
  );
  const rule = rules.find(
    (r) => 'selectorText' in r && (r as CSSStyleRule).selectorText === `.${cls}`
  );
  return rule ? rule.cssText : '';
};

describe('TextElement', () => {
  it('applies independently configured border sides to prefixed states', () => {
    const element = {
      styles: {
        hover_border_left_color: '00287A',
        hover_border_left_pattern: 'dashed',
        hover_border_left_width: 2
      },
      mobile_styles: {}
    };
    const responsiveStyles = new ResponsiveStyles(
      element,
      ['borderHover'],
      true
    );

    expect(
      responsiveStyles.applyBorders({
        target: 'borderHover',
        prefix: 'hover_'
      })
    ).toBe(true);
    expect(responsiveStyles.getTarget('borderHover', true)).toEqual({
      borderLeftColor: '#00287A !important',
      borderLeftStyle: 'dashed !important',
      borderLeftWidth: '2px !important'
    });
  });

  it('removes an inherited desktop border when mobile explicitly clears it', () => {
    const element = {
      styles: {
        border_left_color: '00287A',
        border_left_pattern: 'solid',
        border_left_width: 3
      },
      mobile_styles: {
        border_left_color: '',
        border_left_pattern: '',
        border_left_width: 0
      }
    };
    const responsiveStyles = new ResponsiveStyles(
      element,
      ['border'],
      true
    );

    expect(responsiveStyles.applyBorders({ target: 'border' })).toBe(true);
    expect(responsiveStyles.getTarget('border')).toEqual({
      borderLeftColor: '#00287A',
      borderLeftStyle: 'solid',
      borderLeftWidth: '3px',
      '@media (max-width: 478px)': {
        borderLeftWidth: '0px'
      }
    });
  });

  it('renders a left border without requiring the other border sides', async () => {
    const TextElement = (await import('../TextElement')).default;
    const element = {
      id: 'text-left-border',
      properties: {},
      styles: {
        border_left_color: '00287A',
        border_left_pattern: 'solid',
        border_left_width: 3
      },
      mobile_styles: {}
    };
    const responsiveStyles = new ResponsiveStyles(element, [], true);

    const { container } = render(
      <TextElement element={element} responsiveStyles={responsiveStyles} />
    );

    const rule = ruleFor(container.querySelector('#bb-text-left-border'));
    expect(rule).toContain('border-left-color: #00287A');
    expect(rule).toContain('border-left-style: solid');
    expect(rule).toContain('border-left-width: 3px');
    expect(rule).not.toContain('border-top-');
    expect(rule).not.toContain('border-right-');
    expect(rule).not.toContain('border-bottom-');
  });

  it('renders inner padding and corners inside the element width', async () => {
    const TextElement = (await import('../TextElement')).default;
    const element = {
      id: 'text-1',
      properties: {},
      styles: {
        uploader_padding_top: 20,
        uploader_padding_right: 20,
        uploader_padding_bottom: 20,
        uploader_padding_left: 20,
        corner_top_left_radius: 8,
        corner_top_right_radius: 8,
        corner_bottom_left_radius: 8,
        corner_bottom_right_radius: 8
      },
      mobile_styles: {}
    };
    const responsiveStyles = new ResponsiveStyles(element, [], true);

    const { container } = render(
      <TextElement element={element} responsiveStyles={responsiveStyles} />
    );

    const rule = ruleFor(container.firstElementChild);
    expect(rule).toContain('padding-top: 20px');
    expect(rule).toContain('padding-right: 20px');
    expect(rule).toContain('padding-bottom: 20px');
    expect(rule).toContain('padding-left: 20px');
    expect(rule).toContain('border-radius: 8px 8px 8px 8px');
    // Padding must render inside the 100% width (border-box), not on top of
    // it — a content-box div would overflow its grid cell by the padding.
    expect(rule).toContain('box-sizing: border-box');
  });

  it('renders no padding properties when the keys are absent', async () => {
    const TextElement = (await import('../TextElement')).default;
    const element = {
      id: 'text-2',
      properties: {},
      styles: {},
      mobile_styles: {}
    };
    const responsiveStyles = new ResponsiveStyles(element, [], true);

    const { container } = render(
      <TextElement element={element} responsiveStyles={responsiveStyles} />
    );

    const rule = ruleFor(container.firstElementChild);
    expect(rule).not.toBe('');
    expect(rule).not.toContain('padding-top');
    expect(rule).not.toContain('box-sizing');
  });
});

describe('TextElement certification naming', () => {
  const renderText = async (properties: any) => {
    const TextElement = (await import('../TextElement')).default;
    const element = { key: 'intro-copy', properties, styles: {}, mobile_styles: {} };
    const responsiveStyles = new ResponsiveStyles(element, ['text'], true);
    const { container } = render(
      <TextElement element={element} responsiveStyles={responsiveStyles} />
    );
    return container.firstElementChild as HTMLElement;
  };

  it('names the block by its content so clicks on it are attributed', async () => {
    const root = await renderText({ text: '  Welcome to\n  the plan picker ' });
    expect(root.getAttribute('name')).toBe('Welcome to the plan picker');
  });

  it('falls back to the element key when the text is empty', async () => {
    const root = await renderText({ text: '' });
    expect(root.getAttribute('name')).toBe('intro-copy');
  });
});

