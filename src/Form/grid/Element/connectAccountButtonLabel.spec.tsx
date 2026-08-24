import React from 'react';
import { render, screen } from '@testing-library/react';
import Element from '.';
import { fieldValues } from '../../../utils/init';
import { ACTION_CONNECT_ACCOUNT } from '../../../utils/elementActions';

// Mocked out so this spec exercises only the button-label override logic in
// this file (Finding 3), not the styling engine (ResponsiveStyles) - which
// isn't built to run against a bare-bones test element and belongs to its
// own tests.
jest.mock('../../../elements', () => ({
  __esModule: true,
  default: {
    ButtonElement: ({ element }: any) => (
      <div
        data-testid='btn-text'
        data-formatted={JSON.stringify(element.properties.text_formatted)}
      >
        {element.properties.text}
      </div>
    )
  }
}));

const EMAIL_KEY = 'feathery.connections.box.email';
const SCHWAB_KEY = 'feathery.connections.charles-schwab.connected';

const baseForm = {
  elementProps: {},
  activeStep: {},
  buttonLoaders: {},
  customClickSelectionState: () => null,
  buttonOnClick: jest.fn(),
  inlineErrors: {},
  formSettings: {},
  visiblePositions: {},
  featheryContext: {},
  onViewElements: []
};

const LABEL_STYLES = {
  font_size: 24,
  font_color: 'FF0000FF',
  font_weight: 700
};

const buildButtonNode = (
  manageButtonLabel: boolean | undefined,
  provider = 'box'
) => ({
  id: 'btn-1',
  type: 'button',
  styles: {},
  properties: {
    text: "Builder's label",
    text_formatted: [
      { insert: "Builder's label", attributes: { ...LABEL_STYLES } }
    ],
    actions: [
      {
        type: ACTION_CONNECT_ACCOUNT,
        provider,
        ...(manageButtonLabel === undefined
          ? {}
          : { manage_button_label: manageButtonLabel })
      }
    ]
  }
});

describe('connect_account button label management', () => {
  afterEach(() => {
    delete (fieldValues as any)[EMAIL_KEY];
    delete (fieldValues as any)[SCHWAB_KEY];
  });

  it('shows the connected account when managed and a connection exists', () => {
    (fieldValues as any)[EMAIL_KEY] = 'respondent@example.com';
    render(<Element node={buildButtonNode(undefined)} form={baseForm} />);

    expect(screen.getByTestId('btn-text').textContent).toBe(
      'respondent@example.com'
    );
  });

  it("shows the builder's text when manage_button_label is false, even if connected", () => {
    (fieldValues as any)[EMAIL_KEY] = 'respondent@example.com';
    render(<Element node={buildButtonNode(false)} form={baseForm} />);

    expect(screen.getByTestId('btn-text').textContent).toBe("Builder's label");
  });

  it('prompts to connect when managed and no connection exists yet', () => {
    render(<Element node={buildButtonNode(undefined)} form={baseForm} />);

    expect(screen.getByTestId('btn-text').textContent).toBe(
      'Connect your Box account'
    );
  });

  it('reports the provider name for a connection with no account identity', () => {
    // Schwab's connection value is a flag, not something to show on a button.
    (fieldValues as any)[SCHWAB_KEY] = 'true';
    render(
      <Element
        node={buildButtonNode(undefined, 'charles-schwab')}
        form={baseForm}
      />
    );

    expect(screen.getByTestId('btn-text').textContent).toBe(
      'Charles Schwab connected'
    );
  });

  it('prompts to connect an identity-less provider before it is connected', () => {
    render(
      <Element
        node={buildButtonNode(undefined, 'charles-schwab')}
        form={baseForm}
      />
    );

    expect(screen.getByTestId('btn-text').textContent).toBe(
      'Connect your Charles Schwab account'
    );
  });

  it("keeps the builder's font styling on the managed label", () => {
    // The delta run's attributes carry the font styles; replacing the run with
    // a bare insert would render the managed label unstyled.
    (fieldValues as any)[EMAIL_KEY] = 'respondent@example.com';
    render(<Element node={buildButtonNode(undefined)} form={baseForm} />);

    const formatted = JSON.parse(
      screen.getByTestId('btn-text').getAttribute('data-formatted') as string
    );
    expect(formatted).toEqual([
      { insert: 'respondent@example.com', attributes: LABEL_STYLES }
    ]);
  });

  it('styles the disconnected prompt the same way', () => {
    render(<Element node={buildButtonNode(undefined)} form={baseForm} />);

    const formatted = JSON.parse(
      screen.getByTestId('btn-text').getAttribute('data-formatted') as string
    );
    expect(formatted[0].attributes).toEqual(LABEL_STYLES);
    expect(formatted[0].insert).toBe('Connect your Box account');
  });
});
