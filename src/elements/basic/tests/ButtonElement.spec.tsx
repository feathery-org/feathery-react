import { render, screen } from '@testing-library/react';
import ButtonElement from '../ButtonElement';
import ResponsiveStyles from '../../styles';
import { fieldValues } from '../../../utils/init';
import { ACTION_CONNECT_ACCOUNT } from '../../../utils/elementActions';

// The styling engine and border hook aren't built to run against a bare-bones
// test element, and belong to their own tests. TextNodes stands in for the
// rendered label so this spec exercises only what ButtonElement feeds it.
jest.mock('../../components/TextNodes', () => ({
  __esModule: true,
  default: ({ element, editMode }: any) => (
    <div data-testid='label' data-edit-mode={editMode}>
      {element.properties.text}
    </div>
  )
}));
jest.mock('../../components/useBorder', () => ({
  __esModule: true,
  default: () => ({ borderStyles: {}, customBorder: null })
}));
// jsdom has no matchMedia, which the hover guard probes for.
jest.mock('../../../utils/browser', () => ({
  ...jest.requireActual('../../../utils/browser'),
  hoverStylesGuard: (styles: any) => styles
}));

const mockResponsiveStyles = {
  addTargets: jest.fn(),
  apply: jest.fn(),
  applyBackgroundColorGradient: jest.fn(),
  applyBoxShadow: jest.fn(),
  applyColor: jest.fn(),
  applyContentAlign: jest.fn(),
  applyCorners: jest.fn(),
  applyFlexDirection: jest.fn(),
  applyMargin: jest.fn(),
  applySpanSelectorStyles: jest.fn(),
  applyTextAlign: jest.fn(),
  applyWidth: jest.fn(),
  getMobileBreakpoint: jest.fn().mockReturnValue(478),
  getTarget: jest.fn().mockReturnValue({}),
  getTargets: jest.fn().mockReturnValue({})
};

const EMAIL_KEY = 'feathery.connections.box.email';

const connectButton = (action: any = {}) => ({
  id: 'btn-1',
  styles: {},
  properties: {
    text: "Builder's label",
    text_formatted: [{ insert: "Builder's label" }],
    actions: [{ type: ACTION_CONNECT_ACCOUNT, provider: 'box', ...action }]
  }
});

const renderButton = (element: any, editMode?: string) =>
  render(
    <ButtonElement
      element={element}
      responsiveStyles={mockResponsiveStyles}
      editMode={editMode}
    />
  );

describe('ButtonElement connect account label', () => {
  afterEach(() => {
    delete (fieldValues as any)[EMAIL_KEY];
  });

  it('reports the connection status instead of the builder label', () => {
    (fieldValues as any)[EMAIL_KEY] = 'respondent@example.com';
    renderButton(connectButton());

    expect(screen.getByTestId('label').textContent).toBe(
      'respondent@example.com'
    );
  });

  it("keeps the builder's label when they opted out of managing it", () => {
    (fieldValues as any)[EMAIL_KEY] = 'respondent@example.com';
    renderButton(connectButton({ manage_button_label: false }));

    expect(screen.getByTestId('label').textContent).toBe("Builder's label");
  });

  it('turns off inline editing of a computed label in the builder', () => {
    renderButton(connectButton(), 'editable');

    const label = screen.getByTestId('label');
    expect(label.getAttribute('data-edit-mode')).toBe('disabled');
    expect(label.textContent).toBe('Connect your Box account');
  });

  it('leaves inline editing on for a label the builder owns', () => {
    renderButton(connectButton({ manage_button_label: false }), 'editable');

    expect(screen.getByTestId('label').getAttribute('data-edit-mode')).toBe(
      'editable'
    );
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
  it.each([
    ['black', 'brightness(0%)'],
    ['white', 'brightness(100%)']
  ])(
    'renders stored glyphs with %s image state colors',
    async (color, filter) => {
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
          icon_color: 'F5A623',
          hover_image_color: color,
          selected_image_color: color,
          disabled_image_color: color
        },
        mobile_styles: {}
      };
      const responsiveStyles = new ResponsiveStyles(element, [], true);

      const { container } = render(
        <ButtonElement element={element} responsiveStyles={responsiveStyles} />
      );
      const button = container.querySelector('button');
      const icon = container.querySelector('[data-feathery-button-icon] svg');
      const rules = rulesFor(button).filter((rule) =>
        rule.cssText.includes(filter)
      );
      const hasRule = (state: string, target: string) =>
        rules.some(
          (rule) =>
            rule.selectorText.includes(state) &&
            rule.selectorText.includes(target)
        );

      expect(icon).toHaveAttribute('stroke', 'currentColor');
      expect(responsiveStyles.getTarget('img').color).toBe('#F5A623');
      expect(hasRule(':hover', 'img')).toBe(true);
      expect(hasRule(':hover', '[data-feathery-button-icon]')).toBe(true);
      expect(hasRule('.active', 'img')).toBe(true);
      expect(hasRule('.active', '[data-feathery-button-icon]')).toBe(true);
      expect(hasRule('[aria-disabled="true"]', 'img')).toBe(true);
      expect(
        hasRule('[aria-disabled="true"]', '[data-feathery-button-icon]')
      ).toBe(true);
    }
  );

  const renderIconButton = (text: string, styles: Record<string, any>) => {
    const element = {
      id: 'button-icon-gap',
      properties: {
        actions: [{}],
        icon_source: 'IconHeart',
        icon_glyph: {
          variant: 'outline',
          nodes: [['path', { d: 'M12 5l0 14' }]]
        },
        text,
        text_formatted: text ? [{ insert: text }] : []
      },
      styles: { background_color: 'FFFFFF', ...styles },
      mobile_styles: {}
    };
    const { container } = render(
      <ButtonElement
        element={element}
        responsiveStyles={new ResponsiveStyles(element, [], true)}
      />
    );
    return rulesFor(container.querySelector('[data-feathery-button-icon]'))
      .map((rule) => rule.cssText)
      .join('');
  };

  it.each([
    ['row', 'margin-right'],
    ['row-reverse', 'margin-left'],
    ['column', 'margin-bottom'],
    ['column-reverse', 'margin-top']
  ])('spaces a %s icon from its label on the %s side', (direction, side) => {
    expect(renderIconButton('Next', { flex_direction: direction })).toContain(
      `${side}: 0.5em`
    );
  });

  it('leaves the icon flush when it has no label or authored margins', () => {
    expect(renderIconButton('', { flex_direction: 'row' })).not.toContain(
      '0.5em'
    );
    expect(
      renderIconButton('Next', { flex_direction: 'row', image_margin_right: 4 })
    ).not.toContain('0.5em');
  });

  it('scales a 1em icon with the label mobile font size', async () => {
    const ButtonElement = (await import('../ButtonElement')).default;
    const element = {
      id: 'button-icon-mobile',
      properties: {
        actions: [{}],
        icon_source: 'IconHeart',
        icon_glyph: {
          variant: 'outline',
          nodes: [['path', { d: 'M12 5l0 14' }]]
        },
        text: 'Buy',
        text_formatted: [
          { insert: 'Buy', attributes: { font_size: 24, mobile_font_size: 14 } }
        ]
      },
      styles: { background_color: 'FFFFFF', flex_direction: 'row' },
      mobile_styles: {}
    };
    const responsiveStyles = new ResponsiveStyles(element, [], true);

    const { container } = render(
      <ButtonElement element={element} responsiveStyles={responsiveStyles} />
    );
    const className = Array.from(
      container.querySelector('[data-feathery-button-icon]')!.classList
    ).find((name) => name.startsWith('css-'));
    const mobileCss = Array.from(document.head.querySelectorAll('style'))
      .flatMap((style) =>
        Array.from((style as HTMLStyleElement).sheet?.cssRules ?? [])
      )
      .map((rule) => rule.cssText)
      .filter(
        (css) => css.startsWith('@media') && css.includes(`.${className}`)
      )
      .join('');

    expect(mobileCss).toContain('font-size: 14px');
  });
});
