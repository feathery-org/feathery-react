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
      <div data-testid='btn-text'>{element.properties.text}</div>
    )
  }
}));

const EMAIL_KEY = 'feathery.connections.box.email';

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

const buildButtonNode = (manageButtonLabel: boolean | undefined) => ({
  id: 'btn-1',
  type: 'button',
  styles: {},
  properties: {
    text: "Builder's label",
    text_formatted: [{ insert: "Builder's label" }],
    actions: [
      {
        type: ACTION_CONNECT_ACCOUNT,
        provider: 'box',
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

  it("shows the builder's text when managed but no connection exists yet", () => {
    render(<Element node={buildButtonNode(undefined)} form={baseForm} />);

    expect(screen.getByTestId('btn-text').textContent).toBe("Builder's label");
  });
});
