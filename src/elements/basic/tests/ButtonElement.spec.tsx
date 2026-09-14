import { render, screen } from '@testing-library/react';
import ButtonElement from '../ButtonElement';
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
